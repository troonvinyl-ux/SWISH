// SWISH Listing Verification Service
// Mandatory verification gate: NO listing publishes until all checks pass.
// Verifies identity, description, condition, price, marketplace, inventory, compliance.

import { getSupabaseClient } from '@/template';

export interface VerificationCheck {
  passed: boolean;
  notes: string;
  warnings?: string[];
}

export interface ListingVerification {
  id: string;
  tenantId: string;
  listingId?: string;
  itemId?: string;
  verifiedAt: string;
  verifiedBy: 'ai' | 'human';
  overallPassed: boolean;
  identityCheck: VerificationCheck;
  descriptionCheck: VerificationCheck;
  conditionCheck: VerificationCheck;
  priceCheck: VerificationCheck;
  marketplaceCheck: VerificationCheck;
  inventoryCheck: VerificationCheck;
  complianceCheck: VerificationCheck;
  failureReasons: string[];
  warnings: string[];
  createdAt: string;
}

function mapVerification(row: any): ListingVerification {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    listingId: row.listing_id ?? undefined,
    itemId: row.item_id ?? undefined,
    verifiedAt: row.verified_at,
    verifiedBy: row.verified_by as 'ai' | 'human',
    overallPassed: row.overall_passed,
    identityCheck: row.identity_check ?? { passed: false, notes: '' },
    descriptionCheck: row.description_check ?? { passed: false, notes: '' },
    conditionCheck: row.condition_check ?? { passed: false, notes: '' },
    priceCheck: row.price_check ?? { passed: false, notes: '' },
    marketplaceCheck: row.marketplace_check ?? { passed: false, notes: '' },
    inventoryCheck: row.inventory_check ?? { passed: false, notes: '' },
    complianceCheck: row.compliance_check ?? { passed: false, notes: '' },
    failureReasons: row.failure_reasons ?? [],
    warnings: row.warnings ?? [],
    createdAt: row.created_at,
  };
}

// ── Verification Gate ─────────────────────────────────────────────────────────
// Performs all verification checks against item + listing data.
// Returns pass/fail per check and overall verdict.

export async function verifyListing(
  tenantId: string,
  listingId: string
): Promise<{ verification: ListingVerification | null; error: string | null }> {
  const supabase = getSupabaseClient();

  // Fetch listing + item
  const { data: listing, error: lErr } = await supabase
    .from('listings')
    .select('*, items(*)')
    .eq('id', listingId)
    .eq('tenant_id', tenantId)
    .single();

  if (lErr || !listing) {
    return { verification: null, error: lErr?.message ?? 'Listing not found' };
  }

  const item = listing.items;
  const failureReasons: string[] = [];
  const warnings: string[] = [];

  // ── 1. IDENTITY CHECK ──────────────────────────────────────────────────────
  const identityCheck: VerificationCheck = { passed: false, notes: '' };
  {
    const hasTitle = !!(listing.title && listing.title.length >= 10);
    const hasItem = !!item;
    const hasSpecialist = !!(item?.specialist_id);
    const confidenceOk = Number(item?.identification_confidence ?? 0) >= 0.5;
    const notUnknown = item?.canonical_title !== 'Unknown Item';

    if (!hasTitle) failureReasons.push('Listing title is missing or too short');
    if (!hasItem) failureReasons.push('No item linked to listing');
    if (!confidenceOk) warnings.push('AI identification confidence is below 50% — verify manually');
    if (!notUnknown) warnings.push('Item may not be correctly identified');

    identityCheck.passed = hasTitle && hasItem && hasSpecialist;
    identityCheck.notes = identityCheck.passed
      ? `Identified as ${item?.specialist_id ?? 'unknown'} with ${Math.round(Number(item?.identification_confidence ?? 0) * 100)}% confidence`
      : 'Identity verification failed: missing title or item link';
  }

  // ── 2. DESCRIPTION CHECK ──────────────────────────────────────────────────
  const descriptionCheck: VerificationCheck = { passed: false, notes: '' };
  {
    const hasDesc = !!(listing.description && listing.description.length >= 20);
    const notTooShort = listing.description?.length >= 80;

    if (!hasDesc) failureReasons.push('Description is missing or too short (minimum 20 characters)');
    if (hasDesc && !notTooShort) warnings.push('Description is brief — consider expanding for better conversion');

    descriptionCheck.passed = hasDesc;
    descriptionCheck.notes = hasDesc
      ? `Description present (${listing.description?.length ?? 0} characters)`
      : 'Description missing or insufficient';
  }

  // ── 3. CONDITION CHECK ────────────────────────────────────────────────────
  const conditionCheck: VerificationCheck = { passed: false, notes: '' };
  {
    const hasCondition = !!(item?.condition && item.condition !== 'Unknown');
    const hasConditionId = !!(listing.title); // condition_id would be in title/description for our schema

    if (!hasCondition) warnings.push('Item condition not recorded — buyers may be deterred');

    conditionCheck.passed = true; // Non-blocking but warnings surfaced
    conditionCheck.notes = hasCondition
      ? `Condition: ${item?.condition}${item?.condition_grade ? ` (Grade ${item.condition_grade})` : ''}`
      : 'Condition not specified — add condition details for better conversion';
  }

  // ── 4. PRICE CHECK ────────────────────────────────────────────────────────
  const priceCheck: VerificationCheck = { passed: false, notes: '' };
  {
    const price = Number(listing.price ?? 0);
    const floorPrice = Number(listing.floor_price ?? 0);
    const acquiredCost = Number(item?.acquired_cost ?? 0);
    const valuationLow = Number(item?.valuation_low ?? 0);
    const valuationHigh = Number(item?.valuation_high ?? 0);

    const priceIsPositive = price > 0;
    const priceAboveFloor = floorPrice === 0 || price >= floorPrice;
    // Only block if acquired cost is set AND price is less than 50% of cost (very obvious loss)
    const priceAboveCost = acquiredCost === 0 || price > acquiredCost * 0.5;
    const priceWithinValuation = valuationHigh === 0 || price <= valuationHigh * 3;

    if (!priceIsPositive) failureReasons.push('Price must be greater than zero');
    // Floor price is AI-generated — treat as a warning, not a hard block.
    // The user has the authority to set their own listing price.
    if (!priceAboveFloor && floorPrice > 0) warnings.push(`Price £${price} is below the AI-suggested floor price £${floorPrice} — you can lower the floor price in the listing editor if this is intentional`);
    if (!priceAboveCost) warnings.push(`Price £${price.toFixed(2)} is very low vs acquisition cost £${acquiredCost.toFixed(2)}`);
    if (!priceWithinValuation) warnings.push(`Price £${price} significantly exceeds high valuation £${valuationHigh}`);
    if (valuationLow > 0 && price < valuationLow * 0.3) warnings.push(`Price £${price} is significantly below low valuation — check if correct`);

    priceCheck.passed = priceIsPositive; // floor price is now advisory only
    priceCheck.notes = priceCheck.passed
      ? `Price £${price} within acceptable range (floor £${floorPrice}, cost £${acquiredCost})`
      : `Price check failed — see failure reasons`;
  }

  // ── 5. MARKETPLACE CHECK ─────────────────────────────────────────────────
  const marketplaceCheck: VerificationCheck = { passed: false, notes: '' };
  {
    const hasMarketplace = !!(listing.marketplace_id);
    const validMarketplaces = ['ebay', 'etsy', 'amazon', 'vinted', 'depop', 'gumtree', 'whatnot'];
    const isValidMarketplace = !hasMarketplace || validMarketplaces.includes(listing.marketplace_id.toLowerCase());

    if (!hasMarketplace) failureReasons.push('No marketplace selected');
    if (!isValidMarketplace) failureReasons.push(`Unknown marketplace: ${listing.marketplace_id}`);

    marketplaceCheck.passed = hasMarketplace && isValidMarketplace;
    marketplaceCheck.notes = marketplaceCheck.passed
      ? `Marketplace: ${listing.marketplace_id}`
      : 'Marketplace check failed';
  }

  // ── 6. INVENTORY CHECK ───────────────────────────────────────────────────
  const inventoryCheck: VerificationCheck = { passed: false, notes: '' };
  {
    const hasItem = !!item;
    const itemNotSold = item?.status !== 'sold';
    const itemNotDeleted = !!item;

    // Check for duplicate active listings
    const { count: duplicateCount } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', listing.item_id)
      .in('status', ['active', 'published'])
      .neq('id', listingId);

    const noDuplicates = (duplicateCount ?? 0) === 0;

    if (!hasItem) failureReasons.push('Linked item not found in inventory');
    if (!itemNotSold) failureReasons.push('Item is already marked as sold — cannot list again');
    if (!noDuplicates) warnings.push(`${duplicateCount} other active listing(s) exist for this item — potential duplicate`);

    inventoryCheck.passed = hasItem && itemNotSold;
    inventoryCheck.notes = inventoryCheck.passed
      ? `Item ${item?.id?.slice(0, 8)} in inventory with status: ${item?.status}`
      : 'Inventory check failed';
  }

  // ── 7. COMPLIANCE CHECK ──────────────────────────────────────────────────
  const complianceCheck: VerificationCheck = { passed: false, notes: '' };
  {
    const itemWarnings: string[] = item?.warnings ?? [];
    const hasAuthenticityWarning = itemWarnings.some(w =>
      w.toLowerCase().includes('fake') ||
      w.toLowerCase().includes('counterfeit') ||
      w.toLowerCase().includes('replica') ||
      w.toLowerCase().includes('prohibited')
    );

    if (hasAuthenticityWarning) {
      failureReasons.push('Authenticity or compliance warning detected — review before listing');
    }

    complianceCheck.passed = !hasAuthenticityWarning;
    complianceCheck.notes = complianceCheck.passed
      ? 'No compliance or authenticity concerns detected'
      : 'Compliance check failed — authenticity warning present';
  }

  // ── OVERALL VERDICT ──────────────────────────────────────────────────────
  const overallPassed =
    identityCheck.passed &&
    descriptionCheck.passed &&
    conditionCheck.passed &&
    priceCheck.passed &&
    marketplaceCheck.passed &&
    inventoryCheck.passed &&
    complianceCheck.passed &&
    failureReasons.length === 0;

  // Save verification record
  const { data: savedVerification, error: saveErr } = await supabase
    .from('listing_verifications')
    .insert({
      tenant_id: tenantId,
      listing_id: listingId,
      item_id: listing.item_id,
      verified_by: 'ai',
      overall_passed: overallPassed,
      identity_check: identityCheck,
      description_check: descriptionCheck,
      condition_check: conditionCheck,
      price_check: priceCheck,
      marketplace_check: marketplaceCheck,
      inventory_check: inventoryCheck,
      compliance_check: complianceCheck,
      failure_reasons: failureReasons,
      warnings: warnings,
    })
    .select()
    .single();

  if (saveErr) {
    console.error('Failed to save verification record:', saveErr.message);
  }

  // Update listing status based on verification
  if (overallPassed) {
    await supabase.from('listings').update({ status: 'verified' }).eq('id', listingId);
  } else {
    await supabase.from('listings').update({ status: 'needs_correction' }).eq('id', listingId);
  }

  const verification: ListingVerification = {
    id: savedVerification?.id ?? 'temp',
    tenantId,
    listingId,
    itemId: listing.item_id,
    verifiedAt: new Date().toISOString(),
    verifiedBy: 'ai',
    overallPassed,
    identityCheck,
    descriptionCheck,
    conditionCheck,
    priceCheck,
    marketplaceCheck,
    inventoryCheck,
    complianceCheck,
    failureReasons,
    warnings,
    createdAt: new Date().toISOString(),
  };

  return { verification, error: null };
}

export async function getLatestVerification(
  listingId: string
): Promise<{ verification: ListingVerification | null; error: string | null }> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from('listing_verifications')
    .select('*')
    .eq('listing_id', listingId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return { verification: null, error: error.message };
  if (!data) return { verification: null, error: null };
  return { verification: mapVerification(data), error: null };
}

// ── Human override — mark as verified after manual review ────────────────────
export async function humanOverrideVerification(
  tenantId: string,
  listingId: string,
  notes: string
): Promise<{ error: string | null }> {
  const supabase = getSupabaseClient();

  await supabase.from('listing_verifications').insert({
    tenant_id: tenantId,
    listing_id: listingId,
    verified_by: 'human',
    overall_passed: true,
    identity_check: { passed: true, notes: 'Human override' },
    description_check: { passed: true, notes: 'Human override' },
    condition_check: { passed: true, notes: 'Human override' },
    price_check: { passed: true, notes: 'Human override' },
    marketplace_check: { passed: true, notes: 'Human override' },
    inventory_check: { passed: true, notes: 'Human override' },
    compliance_check: { passed: true, notes: 'Human override' },
    failure_reasons: [],
    warnings: [`Human override: ${notes}`],
  });

  const { error } = await supabase
    .from('listings')
    .update({ status: 'verified' })
    .eq('id', listingId)
    .eq('tenant_id', tenantId);

  return { error: error?.message ?? null };
}
