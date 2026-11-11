import { NICHE_MODULES, NICHES, type ProductionNicheId } from '@/constants/niches';
import { Colors } from '@/constants/theme';
import { nicheToScannerRoute, isRouteAllowedForBuild, isRouteAllowedForModule } from './nicheRouting';
import { getNicheHomeExperience } from './nicheHomeExperience';
import { specialistReviewSummary } from './specialistWorkspaceService';

export interface NicheDashboardAction {
  id: string;
  title: string;
  detail: string;
  icon: string;
  route?: string;
  purpose?: 'listing' | 'valuation' | 'condition';
}
export interface NicheDashboardContent {
  name: string;
  shortName: string;
  accent: string;
  border: string;
  icon: string;
  headline: string;
  categories: string;
  motto: string;
  guidanceTitle: string;
  guidance: string;
  actions: NicheDashboardAction[];
}
const HERO_COPY: Record<ProductionNicheId, { headline: string; categories: string; motto?: string }> = {
  stamps: { headline: 'Small details. A world of stories.', categories: 'Stamps · Sets · Covers · Collections', motto: 'IDENTIFY · CHECK · SORT · SELL' },
  tunes_flip: { headline:'Find the release. Verify the pressing.', categories:'Vinyl · CDs · Cassettes · Box sets', motto:'SCAN · VERIFY · VALUE · LIST · SELL' },
  collectibles: { headline: 'Every find has a story.', categories: 'Toys · Comics · Figures · Memorabilia' },
  tech: { headline: 'Smart tech. Smarter flips.', categories: 'Devices · Cameras · Gaming · Audio' },
  bicycles: { headline: 'Buy smart. Build better. Sell strong.', categories: 'Road · Mountain · Gravel · E-bikes', motto: 'FIND · ASSESS · UPGRADE · FLIP' },
  motocross: { headline: 'Find the bike. Know the potential.', categories: 'Motocross · Enduro · Parts · Equipment', motto: 'IDENTIFY · ASSESS · PREP · FLIP' },
  beauty: { headline: 'Find the product. Check the details.', categories: 'Fragrance · Skincare · Makeup · Beauty' },
  trading_cards: { headline: 'Every card has potential.', categories: 'TCG · Sports · Editions · Collections', motto: 'IDENTIFY · REVIEW · VALUE · FLIP' },
  antiques: { headline: 'Discover the story. Value the evidence.', categories: 'Ceramics · Silver · Art · Decorative antiques', motto: 'IDENTIFY · VALUE · RESTORE · SELL' },
  coins: { headline: 'Small details. Remarkable discoveries.', categories: 'Coins · Banknotes · Silver · Numismatics' },
  clothing: { headline: 'Turn fashion into opportunity.', categories: 'Vintage · Designer · Streetwear · Trainers', motto: 'IDENTIFY · VALUE · STYLE · SELL' },
  fossils: { headline: 'Discover a world before ours.', categories: 'Fossils · Minerals · Specimens · Provenance' },
  surplus_flip: { headline: 'Turn surplus into opportunity.', categories: 'Job lots · Pallets · Manifests · Clearance', motto: 'SOURCE · INSPECT · VALUE · FLIP' },
};

/** Presentation and route selection only: never modifies niche identity or access. */
export function getNicheDashboardContent(nicheId: ProductionNicheId, fixedBuild = false): NicheDashboardContent {
  const niche = NICHES[nicheId];
  const hero = HERO_COPY[nicheId];
  const summary = specialistReviewSummary(nicheId);
  const experience = getNicheHomeExperience(nicheId);
  const allowed = (route: string) => fixedBuild ? isRouteAllowedForBuild(route, nicheId) : isRouteAllowedForModule(route, nicheId);
  const actions: NicheDashboardAction[] = [
    { id: 'identify', title: niche.terms.scan, detail: 'Photos · Next · List or save', icon: 'photo-camera', route: nicheToScannerRoute(nicheId) },
    { id: 'inventory', title: 'My Inventory', detail: `Private ${niche.shortName} stock`, icon: 'inventory-2', route: '/(tabs)/inventory' },
    { id: 'listing', title: 'List Stock', detail: 'Ready-filled listing · List or save', icon: 'sell', purpose: 'listing' },
    { id: 'valuation', title: 'Market Value', detail: 'Comparisons & confidence', icon: 'query-stats', purpose: 'valuation' },
    { id: 'sync', title: 'eBay Sync', detail: 'Review imports & updates', icon: 'sync', route: '/ebay-hub' },
    { id: 'specialist', title: 'Specialist Tools', detail: `${niche.shortName} evidence & checks`, icon: 'fact-check', route: '/specialist-workspace' },
  ];
  if (nicheId === 'tunes_flip') actions.push(
    {id:'discogs',title:'Search Discogs',detail:'Artist · catalogue · editions',icon:'search',route:'/music-search'},
    {id:'barcode',title:'Scan Barcode',detail:'Compare individual releases',icon:'qr-code-scanner',route:'/music-search?barcode=1'},
    {id:'collection',title:'My Collection',detail:'Format · artist · condition',icon:'library-music',route:'/music-collection'},
    {id:'sales',title:'Sales & Profit',detail:'Recorded sales, not asking value',icon:'receipt-long',route:'/money'},
    {id:'tasks',title:'Outstanding Tasks',detail:'Reviews & fulfilment',icon:'assignment',route:'/tasks'}
  );
  if (allowed('/opportunities')) actions.push({ id: 'opportunities', title: 'Opportunities', detail: 'Find your next flip', icon: 'search', route: '/opportunities' });
  if (nicheId === 'antiques') actions.push({ id: 'condition', title: 'Condition Review', detail: 'Wear · damage · restoration', icon: 'assignment', purpose: 'condition' });
  for (const tool of summary.tools) {
    actions.push({ id: `tool:${tool.route}`, title: tool.title, detail: tool.detail, icon: tool.icon, route: tool.route });
  }
  return {
    name: NICHE_MODULES[nicheId].name,
    shortName: niche.shortName,
    accent: nicheId === 'collectibles' ? Colors.primary : niche.color,
    border: nicheId === 'collectibles' ? Colors.gold : niche.color,
    icon: niche.icon,
    headline: hero.headline,
    categories: hero.categories,
    motto: hero.motto ?? 'IDENTIFY · VALUE · FLIP · PROFIT',
    guidanceTitle: experience?.cautionTitle ?? 'Evidence before claims.',
    guidance: experience?.cautionBody ?? `${summary.condition} Identification is provisional. Use comparable-sale evidence; asking prices are not sold prices.`,
    actions: actions.filter(action => !action.route || allowed(action.route)),
  };
}

/** Item selection is explicit, never silently applies an action to the first row. */
export function nicheDashboardItemRoute(nicheId: ProductionNicheId, purpose: 'listing' | 'valuation' | 'condition', itemId: string): string {
  const id = encodeURIComponent(itemId);
  if (purpose === 'listing') return `/create-listing?id=${id}`;
  if (nicheId === 'antiques') return `/${purpose === 'condition' ? 'antique-condition' : 'antique-value'}?id=${id}`;
  return `/stock-listing/${id}`;
}
