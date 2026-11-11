// Source/registry contracts only; installed-device and real eBay acceptance are separate.
import fs from 'node:fs';
import { PRODUCTION_NICHE_IDS } from '@/constants/niches';
import { isRouteAllowedForModule } from '../nicheRouting';
const source = (file: string) => fs.readFileSync(file, 'utf8');
test.each(PRODUCTION_NICHE_IDS)('%s can open the common seller editor and its preparation entry', nicheId => {
  expect(isRouteAllowedForModule('/ebay-listing-editor', nicheId)).toBe(true);
  expect(isRouteAllowedForModule('/create-listing', nicheId)).toBe(true);
});
test('one copy renderer is always visible in both basic and advanced modes', () => {
  const page = source('app/ebay-listing-editor.tsx');
  expect(page.match(/<ListingCopyFields\b/g)).toHaveLength(1);
  expect(page.indexOf('<ListingCopyFields')).toBeLessThan(page.indexOf('{details?<>'));
  expect(page).not.toContain('<PremiumField label="Title"');
  expect(page).not.toContain('<PremiumField label="Description"');
  expect(source('components/feature/ListingReadyPanel.tsx')).not.toContain('<PremiumField label="Title"');
  expect(source('components/feature/ListingReadyPanel.tsx')).not.toContain('<PremiumField label="Description"');
  const copy = source('components/feature/ListingCopyFields.tsx');
  expect(copy).toContain("onGenerate={() => onGenerate('title')}");
  expect(copy).toContain("onGenerate={() => onGenerate('description')}");
  expect(copy).not.toContain('useState');
  expect(source('components/ui/PremiumField.tsx')).toContain('name="auto-awesome"');
  expect(source('components/ui/PremiumField.tsx')).toContain('accessibilityState={{disabled:Boolean(disabled||generating),busy:generating}}');
});
test('stock creation and scanner Next are adapters, not separate seller forms', () => {
  const creation = source('app/create-listing.tsx'), scanner = source('components/feature/QuickListWorkspace.tsx');
  expect(creation).toContain("pathname: '/ebay-listing-editor'");
  expect(scanner).toContain("pathname:'/ebay-listing-editor'");
  for (const ui of [creation, scanner]) {
    expect(ui).not.toContain('<ListingReadyPanel');
    expect(ui).not.toContain('<ListingPhotoManager');
  }
  const preparation = source('hooks/usePreparedListing.ts');
  expect(preparation).toContain('result.existingId || result.draft?.listing.id');
  expect(preparation).not.toMatch(/publishQuickDraft|saveQuickReview|submitListingToMarketplace/);
});
test('AI replacement is locked, scoped, field-only and never saves or revises', () => {
  const hook = source('hooks/useListingEditor.ts');
  const action = hook.slice(hook.indexOf('const generate=async'), hook.indexOf('const submit=async'));
  expect(action).toContain('loadedScope!==scope');
  expect(action).toContain('actionLock.current=true');
  expect(action).toContain('currentScope.current!==scope');
  expect(action).toContain('[field]:result.value!');
  expect(action).not.toMatch(/persistState\(|reviseSavedListing\(|submitListingToMarketplace\(/);
  expect(hook).toContain('useScopedListingActivity(scope)');
  expect(hook).toContain('moduleEpoch');
  expect(source('services/listingCopyService.ts')).not.toMatch(/\.rpc\(|\.from\(|saveListing|submitListingToMarketplace/);
});
test('uniform editor preserves scanner timing, live readback and coin-only automatic photos', () => {
  const hook = source('hooks/useListingEditor.ts'), bridge = source('hooks/useListingQuickSession.ts');
  expect(hook).toContain("quick.mark(ticket,'T5'");
  expect(hook).toContain("quick.mark(ticket,'T6'");
  expect(hook).toContain('quick.confirm(ticket,result.externalListingId,state.media');
  expect(bridge).toContain('confirmQuickLive');
  expect(bridge).toContain("mark(ticket, 'T7', { outcome: 'live'");
  expect(bridge).toContain('value.sessionId === ticket.sessionId');
  expect(bridge).toContain('quickReviewIssue');
  expect(bridge).not.toContain('getQuickListOpenedAt');
  expect(hook).toContain('if(shouldAutoRemoveBackground(nicheId)');
  expect(source('services/preparedListingService.ts')).toContain('if(shouldAutoRemoveBackground(nicheId))');
  expect(source('hooks/useQuickList.ts')).toContain('timing.current=visibleState.timing');
});
