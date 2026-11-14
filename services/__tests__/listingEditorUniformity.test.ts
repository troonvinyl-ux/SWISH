// Source/registry contracts only; installed-device and real eBay acceptance are separate.
import fs from 'node:fs';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { isRouteAllowedForModule } from '../nicheRouting';
const source = (file: string) => fs.readFileSync(file, 'utf8');
test.each(PRODUCTION_NICHE_IDS)('%s can open the common seller editor and its preparation entry', nicheId => {
  expect(isRouteAllowedForModule('/ebay-listing-editor', nicheId)).toBe(true);
  expect(isRouteAllowedForModule('/create-listing', nicheId)).toBe(true);
});
test('basic and advanced editor modes preserve one visible title/description editing path', () => {
  const page = source('app/ebay-listing-editor.tsx');
  expect(page).toContain('<ListingReadyPanel');
  expect(page).toContain('{details?<>');
  expect(page).toContain('title="Title & description"');
  expect(page).toContain("onGenerate={()=>void editor.generate('title')}");
  expect(page).toContain("onGenerate={()=>void editor.generate('description')}");
  expect(source('components/ui/PremiumField.tsx')).toContain('name="auto-awesome"');
  expect(source('components/ui/PremiumField.tsx')).toContain('accessibilityState={{disabled:Boolean(disabled||generating),busy:generating}}');
});
test('stock creation opens the shared editor while Quick List retains one managed short-listing review', () => {
  const creation = source('app/create-listing.tsx'), scanner = source('components/feature/QuickListWorkspace.tsx');
  expect(creation).toContain("pathname: '/ebay-listing-editor'");
  expect(scanner).toContain('<ListingPhotoManager');
  expect(scanner).toContain('flow.confirm(true)');
  expect(scanner).toContain('flow.confirm(false)');
  expect(creation).not.toContain('<ListingReadyPanel');
  const preparation = source('hooks/usePreparedListing.ts');
  expect(preparation).toContain('result.existingId || result.draft?.listing.id');
  expect(preparation).not.toMatch(/publishQuickDraft|saveQuickReview|submitListingToMarketplace/);
});
test('AI replacement is locked, scoped, field-only and never saves or revises', () => {
  const hook = source('hooks/useListingEditor.ts');
  const action = hook.slice(hook.indexOf('const generate=async'), hook.indexOf('const submit=async'));
  expect(action).toContain('if(!state||busy)return');
  expect(action).toContain('currentScope.current!==scope');
  expect(action).toContain('else update(field,result.data.listing[field])');
  expect(action).not.toMatch(/persistState\(|reviseSavedListing\(|submitListingToMarketplace\(/);
  expect(hook).toContain('const categoryRequest=useRef(0),actionLock=useRef(false)');
  expect(source('services/listingCopyService.ts')).not.toMatch(/\.rpc\(|\.from\(|saveListing|submitListingToMarketplace/);
});
test('uniform editor preserves live readback while short-listing keeps timing and coin-only automatic photos', () => {
  const hook = source('hooks/useListingEditor.ts'), bridge = source('hooks/useListingQuickSession.ts');
  expect(hook).toContain('inspectLiveListing(state.tenantId,state.listingId)');
  expect(hook).toContain('const syncPublication=async()=>');
  expect(bridge).toContain('quickReviewIssue');
  expect(source('hooks/useQuickList.ts')).toContain('const elapsedMs=visibleState.timing?.timestamps.T1');
  expect(source('hooks/useQuickList.ts')).toContain('shouldAutoRemoveBackground(nicheId)');
  expect(source('services/preparedListingService.ts')).toContain('processExistingItemPhoto({tenantId,nicheId,itemId,userId,originalUri})');
  expect(source('services/preparedListingService.ts')).toContain('existingOriginalPhotos(item)');
});
