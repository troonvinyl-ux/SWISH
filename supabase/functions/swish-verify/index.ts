// SWISH swish-verify Edge Function
// Runs the mandatory listing verification gate using AI + rule-based checks.
// Called before any listing is allowed to publish.
//
// Security: JWT + tenant membership required (HARDENED).
// Missing/invalid auth = 401. Non-member = 403. No bypass path.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface VerifyRequest {
  listing_id: string;
  tenant_id: string;
  human_override?: boolean;
  override_notes?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('ONSPACE_AI_API_KEY');
    const baseUrl = Deno.env.get('ONSPACE_AI_BASE_URL');
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!apiKey || !baseUrl) {
      return new Response(
        JSON.stringify({ error: 'OnSpace AI not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Auth: HARDENED
    // Missing auth = 401. Anon key = 401. Invalid JWT = 401. Non-member = 403.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token || token === Deno.env.get('SUPABASE_ANON_KEY')) {
      return new Response(
        JSON.stringify({ error: 'Authentication required. Please sign in to SWISH.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid or expired authentication token. Please sign in again.' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body: VerifyRequest = await req.json();
    const { listing_id, tenant_id, human_override = false, override_notes = '' } = body;

    if (!listing_id || !tenant_id) {
      return new Response(
        JSON.stringify({ error: 'listing_id and tenant_id are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the authenticated user belongs to this tenant
    const { data: membership } = await supabaseAdmin
      .from('tenant_memberships')
      .select('id')
      .eq('tenant_id', tenant_id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) {
      console.warn(`[SWISH Security] swish-verify: User ${user.id} attempted tenant ${tenant_id} - not a member`);
      return new Response(
        JSON.stringify({ error: 'Access denied: you are not a member of this organisation.' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch listing + item (scoped to tenant to prevent cross-tenant reads)
    const { data: listing, error: listingError } = await supabaseAdmin
      .from('listings')
      .select('*, items(*)')
      .eq('id', listing_id)
      .eq('tenant_id', tenant_id)
      .single();

    if (listingError || !listing) {
      return new Response(
        JSON.stringify({ error: 'Listing not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Human override path
    if (human_override) {
      await supabaseAdmin.from('listing_verifications').insert({
        tenant_id,
        listing_id,
        item_id: listing.item_id,
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
        warnings: [`Human override: ${override_notes || 'Manual approval'}`],
      });

      await supabaseAdmin.from('listings').update({ status: 'verified' }).eq('id', listing_id);

      return new Response(
        JSON.stringify({ passed: true, override: true, verification: { overall_passed: true, failure_reasons: [], warnings: [] } }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const item = listing.items;
    const failureReasons: string[] = [];
    const warnings: string[] = [];

    // Run verification checks
    const price = Number(listing.price ?? 0);
    const floorPrice = Number(listing.floor_price ?? 0);
    const acquiredCost = Number(item?.acquired_cost ?? 0);
    const valuationHigh = Number(item?.valuation_high ?? 0);
    const confidence = Number(item?.identification_confidence ?? 0);

    // Identity
    const identityPassed = !!(listing.title?.length >= 10) && !!item && !!(item?.specialist_id);
    if (!identityPassed) failureReasons.push('Identity check failed: missing title or item link');
    if (confidence < 0.5) warnings.push(`Low AI confidence (${Math.round(confidence * 100)}%) - manual review recommended`);

    // Description
    const descPassed = !!(listing.description?.length >= 20);
    if (!descPassed) failureReasons.push('Description too short (min 20 characters)');

    // Condition (non-blocking)
    if (!item?.condition || item.condition === 'Unknown') {
      warnings.push('Item condition not recorded');
    }

    // Price
    const pricePassed = price > 0 && (floorPrice === 0 || price >= floorPrice);
    if (price <= 0) failureReasons.push('Price must be greater than zero');
    if (floorPrice > 0 && price < floorPrice) failureReasons.push(`Price £${price} below floor £${floorPrice}`);
    if (acquiredCost > 0 && price < acquiredCost * 0.5) warnings.push(`Price £${price} very low vs acquisition cost £${acquiredCost}`);
    if (valuationHigh > 0 && price > valuationHigh * 3) warnings.push('Price significantly exceeds valuation ceiling');

    // Marketplace
    const validMarketplaces = ['ebay', 'etsy', 'amazon', 'vinted', 'depop', 'gumtree', 'whatnot'];
    const marketplacePassed = !!listing.marketplace_id && validMarketplaces.includes(listing.marketplace_id.toLowerCase());
    if (!listing.marketplace_id) failureReasons.push('No marketplace specified');
    else if (!marketplacePassed) failureReasons.push(`Unknown marketplace: ${listing.marketplace_id}`);

    // Inventory
    const itemNotSold = item?.status !== 'sold';
    const inventoryPassed = !!item && itemNotSold;
    if (!item) failureReasons.push('Linked item not found');
    if (!itemNotSold) failureReasons.push('Item already sold - cannot list again');

    // Check duplicates
    const { count: dupCount } = await supabaseAdmin
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .eq('item_id', listing.item_id)
      .in('status', ['active', 'published', 'verified'])
      .neq('id', listing_id);
    if ((dupCount ?? 0) > 0) warnings.push(`${dupCount} other active listing(s) exist for this item`);

    // Compliance
    const itemWarnings: string[] = item?.warnings ?? [];
    const hasComplianceIssue = itemWarnings.some((w: string) =>
      ['fake', 'counterfeit', 'replica', 'prohibited'].some(term => w.toLowerCase().includes(term))
    );
    if (hasComplianceIssue) failureReasons.push('Compliance warning detected - possible counterfeit or prohibited item');

    // AI-enhanced description check (advisory only - does not block)
    let aiAnalysisWarnings: string[] = [];
    if (listing.description && listing.description.length >= 50 && apiKey && baseUrl) {
      try {
        const aiResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: 'google/gemini-3-flash-preview',
            messages: [{
              role: 'user',
              content: `You are a listing compliance checker. Analyse this eBay listing description for:
1. Any false or unverifiable claims
2. Missing important disclaimers
3. Potentially misleading condition descriptions
4. Keywords that might violate marketplace policies

Item: ${item?.canonical_title ?? 'Unknown'}
Category: ${item?.specialist_id ?? 'general'}
Condition: ${item?.condition ?? 'Unknown'}
Description: ${listing.description.slice(0, 500)}

Respond ONLY with JSON: {"warnings": ["warning1", "warning2"]}
Return an empty array if no issues found. Maximum 3 warnings.`,
            }],
            temperature: 0.1,
            max_tokens: 256,
          }),
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const raw = aiData.choices?.[0]?.message?.content ?? '{}';
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
          const parsed = JSON.parse(cleaned);
          aiAnalysisWarnings = parsed.warnings ?? [];
        }
      } catch {
        // AI check is advisory only - do not fail verification if AI is unavailable
      }
    }

    warnings.push(...aiAnalysisWarnings);

    const overallPassed = failureReasons.length === 0 &&
      identityPassed && descPassed && pricePassed && marketplacePassed && inventoryPassed;

    // Save verification record
    await supabaseAdmin.from('listing_verifications').insert({
      tenant_id,
      listing_id,
      item_id: listing.item_id,
      verified_by: 'ai',
      overall_passed: overallPassed,
      identity_check: { passed: identityPassed, notes: identityPassed ? 'Identity confirmed' : 'Identity check failed' },
      description_check: { passed: descPassed, notes: `${listing.description?.length ?? 0} chars` },
      condition_check: { passed: true, notes: item?.condition ?? 'Not recorded' },
      price_check: { passed: pricePassed, notes: pricePassed ? `£${price} verified` : 'Price check failed' },
      marketplace_check: { passed: marketplacePassed, notes: listing.marketplace_id ?? 'missing' },
      inventory_check: { passed: inventoryPassed, notes: inventoryPassed ? 'In inventory' : 'Inventory check failed' },
      compliance_check: { passed: !hasComplianceIssue, notes: hasComplianceIssue ? 'Compliance issue detected' : 'No compliance issues' },
      failure_reasons: failureReasons,
      warnings,
    });

    // Update listing status
    await supabaseAdmin
      .from('listings')
      .update({ status: overallPassed ? 'verified' : 'needs_correction' })
      .eq('id', listing_id);

    console.log(`Verification: listing ${listing_id} - ${overallPassed ? 'PASSED' : 'FAILED'} (${failureReasons.length} failures, ${warnings.length} warnings)`);

    return new Response(
      JSON.stringify({
        passed: overallPassed,
        failure_reasons: failureReasons,
        warnings,
        checks: {
          identity: identityPassed,
          description: descPassed,
          price: pricePassed,
          marketplace: marketplacePassed,
          inventory: inventoryPassed,
          compliance: !hasComplianceIssue,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('Verification error:', err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
