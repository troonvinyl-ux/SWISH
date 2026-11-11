// Restore the existing niche-aware OnSpace listing generator; never save or publish here.
import { invokeListingOperation } from './listingEditorService';
export type ListingCopyField = 'title' | 'description';
export async function generateListingCopy(input: { tenantId: string; itemId: string; field: ListingCopyField }): Promise<{ value: string | null; error: string | null }> {
  if (!input.tenantId || !input.itemId) return { value: null, error: 'Open a saved item in the current workspace first.' };
  const result = await invokeListingOperation({ item_id: input.itemId, tenant_id: input.tenantId, marketplace_id: 'ebay', fields: [input.field] }, 'swish-list-generate');
  if (result.error) return { value: null, error: result.error };
  const raw = result.data?.listing?.[input.field];
  if (typeof raw !== 'string' || !raw.trim()) return { value: null, error: 'AI returned no usable text. Your current text is unchanged.' };
  if (input.field === 'title' && raw.trim().length > 80) return { value: null, error: 'AI returned a title over 80 characters. Your current title is unchanged; try again.' };
  if (raw.length > 100_000) return { value: null, error: 'AI returned too much text. Your current description is unchanged.' };
  // Description is the complete eBay HTML, not a mobile text projection.
  // Preserve headings, paragraphs, specifics table, inline CSS, entities and provider credit verbatim.
  const value = input.field === 'description' ? raw : raw.trim();
  return value ? { value, error: null } : { value: null, error: 'AI returned no readable text. Your current text is unchanged.' };
}
