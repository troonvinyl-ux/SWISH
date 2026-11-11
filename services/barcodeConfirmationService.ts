// Explicit user confirmation reuses the canonical capture identity and atomic draft RPC. No photo/valuation/marketplace request is required to preview a product.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getSupabaseClient } from '@/template';
import { NICHE_MODULES } from '@/constants/niches';
import type { SpecialistId } from '@/constants/specialists';
import { normalizeProductBarcode, sameGtin, type ProductLead, type QuickListNiche } from '@/shared/quickList';
import { captureCanonicalId } from './captureIdentityService';
import { createQuickInventory } from './quickListService';
import { getItem, type Item } from './itemService';
import { saveListing, getItemListings, type GeneratedListing } from './listingService';
import { persistCapturedItemPhotos } from './photoPersistenceService';
import { captureFromCamera, pickFromLibrary, type CapturedImage, type AIIdentificationResult } from './aiIdentificationService';
import { retainCaptureImage } from './captureDraftService';
export function barcodeIdentificationForInventory(lead: ProductLead, nicheId: QuickListNiche): AIIdentificationResult {
  if (!normalizeProductBarcode(lead.gtin) || !lead.title.trim() || !NICHE_MODULES[nicheId]) throw new Error('Valid barcode, product title and specialist required.');
  const specifics: Record<string, string> = {};
  for (const [key,value] of Object.entries(lead.specifics ?? {})) if (typeof value === 'string' && value.trim() && !/condition|authentic|tested|grade|price|valu|quantity|complet|warranty/i.test(key)) specifics[key] = value.trim();
  const attributes = { ...specifics, barcode: lead.gtin, EAN: lead.gtin, ...(lead.brand ? { manufacturer: lead.brand } : {}), ...(lead.publisher ? { publisher: lead.publisher } : {}), ...(lead.releaseYear ? { year: lead.releaseYear } : {}), ...(lead.releaseDate ? { release_date: lead.releaseDate } : {}), ...(lead.format ? { format: lead.format } : {}), ...(lead.edition ? { edition: lead.edition } : {}), ...(lead.region ? { region: lead.region } : {}), _suggested_ebay_category: lead.suggestedEbayCategory ?? lead.categoryName ?? '',
    _barcode_identification: { ...lead, userConfirmed: true, confirmedAt: new Date().toISOString(), catalogueAssociationVerified: lead.verificationStatus === 'catalogue_verified', physicalConditionVerified: false, authenticityVerified: false },
    _quick_attribute_sources: Object.entries({ ...specifics, EAN: lead.gtin }).map(([key,value]) => ({ key, value, sources: ['user_confirmation'], accepted: true, note: `Product details reviewed by the seller. Original source: ${lead.fieldSources?.[key] ?? lead.source}; not independent authentication.` })),
  };
  return { canonicalTitle: lead.title.trim(), specialistId: NICHE_MODULES[nicheId].defaultSpecialist as SpecialistId, objectType: lead.productCategory || 'retail_product', identificationState: 'candidate', confidence: Math.min(0.79, lead.confidence ?? 0.6), confidenceTier: 'medium', confidenceReason: 'User confirmed the barcode product proposal; source verification remains separately recorded.', identificationSource: 'user_confirmed', condition: '', conditionNotes: '', valuationLow: 0, valuationMid: 0, valuationHigh: 0, valuationConfidence: 'unknown', saleProb30d: null, evidenceSupporting: [], evidenceContradictory: lead.conflicts ?? [], missingInformation: ['Physical condition, completeness and authenticity need seller review.'], attributesConfirmed: { ...specifics, EAN: lead.gtin }, attributesInferred: {}, attributes, warnings: ['Barcode product details confirmed by seller; this is not a condition assessment or authenticity certificate.'], suggestedDisposition: '', dispositionDecision: 'human_review' };
}
export function barcodeDraft(lead: ProductLead): GeneratedListing {
  const description = [lead.title, ...Object.entries(lead.specifics ?? {}).filter(([key,value]) => value && !/condition|authentic|tested|grade|price|valu|quantity|complet|warranty/i.test(key)).map(([key,value]) => `${key}: ${value}`), `Barcode: ${lead.gtin}`].join('\n');
  const specifics = Object.fromEntries(Object.entries(lead.specifics ?? {}).filter(([key,value]) => typeof value === 'string' && value.trim() && key.length <= 65 && value.length <= 65 && !/condition|authentic|tested|grade|price|valu|quantity|complet|warranty/i.test(key)).slice(0, 24));
  return { title: lead.title.trim().slice(0, 80), description, category: lead.suggestedEbayCategory ?? lead.categoryName ?? '', condition_id: '', condition_description: '', recommended_price: 0, floor_price: 0, ceiling_price: 0, item_specifics: { ...specifics, EAN: lead.gtin }, keywords: [], listing_format: 'FixedPriceItem', duration: 'GTC', shipping_profile: '', returns_policy: '', rationale: 'Explicit user-confirmed product proposal. Enter price, condition and current eBay category before publication.', identification_is_provisional: true, price_requires_manual_review: true };
}
export async function retainBarcodePhoto(source: 'camera' | 'library', index: number): Promise<CapturedImage | null> {
  const image = source === 'camera' ? await captureFromCamera() : await pickFromLibrary(`barcode_${index + 1}`, `Product photo ${index + 1}`);
  return image ? retainCaptureImage({ ...image, slotId: `barcode_${index + 1}`, slotLabel: `Product photo ${index + 1}` }) : null;
}
const confirmations = new Map<string, Promise<{ item: Item; listingId: string }>>();
export interface BarcodeConfirmationInput { tenantId: string; userId: string; nicheId: QuickListNiche; sessionId: string; lead: ProductLead; images: CapturedImage[]; existingItemId?: string; isCurrent: () => boolean }
export function confirmBarcodeProduct(input: BarcodeConfirmationInput): Promise<{ item: Item; listingId: string }> {
  const key = `${input.userId}:${input.tenantId}:${input.nicheId}:${input.sessionId}`;
  const existing = confirmations.get(key); if (existing) return existing;
  const task = confirm(input, key).finally(() => confirmations.delete(key)); confirmations.set(key, task); return task;
}
async function confirm(input: BarcodeConfirmationInput, scope: string): Promise<{ item: Item; listingId: string }> {
  const { tenantId, userId, nicheId, sessionId, lead, images, isCurrent } = input;
  const assertCurrent = () => { if (!isCurrent()) throw new Error('Workspace changed. Reopen the original saved item; no replacement was created.'); };
  assertCurrent();
  const session = await getSupabaseClient().auth.getSession();
  if (session.error || session.data.session?.user.id !== userId) throw new Error('Sign in to the original account before confirming.');
  const canonicalId = input.existingItemId ?? await captureCanonicalId(tenantId, nicheId, sessionId);
  // Persist a recovery receipt before the first write. Same-session retries and ambiguous responses reuse exactly the same item/draft.
  await AsyncStorage.setItem(`@swish_barcode_confirmation:${scope}`, JSON.stringify({ itemId: canonicalId, barcode: lead.gtin, title: lead.title }));
  assertCurrent();
  const initial = await getSupabaseClient().from('items').select('id,tenant_id,specialist_id,attributes').eq('id', canonicalId).eq('tenant_id',tenantId).maybeSingle();
  if (initial.error) throw new Error('Could not check the canonical item. Retry this confirmation, not a new scan.');
  let item: Item;
  if (initial.data) {
    if (!NICHE_MODULES[nicheId].specialists.includes(initial.data.specialist_id) || initial.data.attributes?._capture_session_id !== sessionId) throw new Error('Saved item belongs to another scan or specialist. Open its inventory overview.');
    const stored = initial.data.attributes?._barcode_identification;
    if (stored && (!sameGtin(stored.gtin ?? '', lead.gtin) || stored.title !== lead.title)) throw new Error('This product was already confirmed with different details. Edit the existing saved item instead of creating another.');
    const read = await getItem(canonicalId); if (read.error || !read.item) throw new Error(read.error ?? 'Saved item could not be reopened.'); item = read.item;
  } else {
    const result = barcodeIdentificationForInventory(lead, nicheId);
    assertCurrent(); item = await createQuickInventory(tenantId, result, sessionId);
    if (item.id !== canonicalId) throw new Error('Capture identity differs. Open the existing item; do not duplicate it.');
  }
  assertCurrent();
  if (images.length) {
    const photos = await persistCapturedItemPhotos(tenantId, item.id, images, { appendOnly: true, processImages: true, isCurrent });
    if (!photos.complete) throw new Error(`Item ${item.inventoryId ?? item.id} is saved. Retry photos on this same item. ${photos.errors.join(' ')}`);
    const read = await getItem(item.id); if (read.error || !read.item) throw new Error('Photos saved; reload this item before continuing.'); item = read.item;
  }
  assertCurrent();
  const listings = await getItemListings(item.id); if (listings.error) throw new Error(listings.error);
  const draft = listings.listings.find(row => row.tenantId === tenantId && row.marketplaceId === 'ebay' && row.status === 'draft');
  if (draft) return { item, listingId: draft.id };
  if (listings.listings.some(row => row.externalListingId || ['active','live','publishing'].includes(row.status))) throw new Error('This item already has a marketplace listing. Open the existing listing.');
  const saved = await saveListing(tenantId, item.id, barcodeDraft(lead));
  if (saved.error || !saved.listing) throw new Error(saved.error ?? 'Draft was not confirmed. Retry on the saved item.');
  await AsyncStorage.setItem(`@swish_barcode_confirmation:${scope}`, JSON.stringify({ itemId:item.id, listingId:saved.listing.id, barcode:lead.gtin }));
  return { item, listingId: saved.listing.id };
}
