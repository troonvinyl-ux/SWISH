import fs from 'node:fs';
import path from 'node:path';
import { normaliseManifest } from '@/services/manifestParser';
import { evaluateManifestLot, toLotLines, DEFAULT_LOT_ASSUMPTIONS } from '@/services/lotEconomicsService';
import { presentLotVerdict, lotMoney, friendlyLotMessage, friendlyManifestError, bestManifestProducts } from '@/services/manifestExperienceService';
import { MANIFEST_PHASES, LOT_COST_GROUPS, LOT_STEPS } from '@/constants/manifestExperience';
const source=(file:string)=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
const lines=()=>toLotLines(normaliseManifest([['Title','Quantity','Unit RRP'],['Plain widget',2,200],['Small widget',3,20]]).rows);
const inputs=()=>({...DEFAULT_LOT_ASSUMPTIONS,currentBid:1,inbound:0,reserve:0,labourMinutes:0,feeRate:0,fixedFee:0,sellerPostage:0,packaging:0,yieldRate:1,conservativeYield:1,sellThrough:1,conservativeSellThrough:1,targetProfit:10,targetRoi:0,budget:500});
describe('Simple lot presentation preserves the real calculation',()=>{
  test('the journey has exactly three steps',()=>expect(LOT_STEPS).toHaveLength(3));
  test('retail-only inputs still say check first, never a confirmed opportunity',()=>{
    const result=evaluateManifestLot(lines(),inputs());const display=presentLotVerdict(result);
    expect(result.decision).toBe('research');expect(display.title).toBe('A closer look first');expect(display.priceNote).toContain('not recent sales');
  });
  test('high bid is still a swerve, regardless of the visual presentation',()=>{
    const result=evaluateManifestLot(lines(),{...inputs(),currentBid:999});expect(presentLotVerdict(result).title).toBe('Swerve this one');
  });
  test('profits belong to the same strategy used by the bid cap, not the highest optimistic headline',()=>{
    const result=evaluateManifestLot(lines(),inputs());const display=presentLotVerdict(result);
    expect(display.cautious).toBe(result.best);expect(display.expected.strategy).toBe(result.best.strategy);
    expect(display.expected.profit).toBe(result.expected.find(s=>s.strategy===result.best.strategy)?.profit);
  });
  test('no bid means unknown profit, not a fake zero',()=>{
    const display=presentLotVerdict(evaluateManifestLot(lines(),{...inputs(),currentBid:null}));
    expect(display.expected.profit).toBeNull();expect(lotMoney(display.expected.profit)).toBe('—');
  });
  test('ended remains ended even when the lot has room for profit',()=>expect(presentLotVerdict(evaluateManifestLot(lines(),{...inputs(),minutesLeft:0})).title).toBe('This auction has ended'));
  test('formatting preserves zero, negative results and unknown figures',()=>{
    expect(lotMoney(0)).toBe('£0.00');expect(lotMoney(-9.25)).toBe('£-9.25');expect(lotMoney(NaN)).toBe('—');expect(lotMoney(Infinity)).toBe('—');expect(lotMoney(undefined)).toBe('—');
  });
  test('plain-English warnings retain the safety instruction',()=>expect(friendlyLotMessage('Safety-critical return: exclude resale until provenance, impact history and safety are verified by a competent person.')).toContain('Do not resell'));
  test('duplicate quantities remain a check rather than being hidden as success',()=>expect(friendlyLotMessage('Repeated SKU ABC: rows kept separate; review duplicate quantities.')).toContain('do not count the same stock twice'));
  test('barcode warning never turns into approval',()=>expect(friendlyLotMessage('EAN is rounded/scientific or fails its check digit.')).toContain('checking'));
  test('missing bid error is actionable',()=>expect(friendlyManifestError('Enter the current bid in pounds.')).toContain('Add the current bid'));
  test('unknown failures never leak SQL or provider details into the experience',()=>expect(friendlyManifestError('SQLSTATE 23505: private_backend_table error')).not.toContain('SQLSTATE'));
  test('ranking does not alter row data or invent demand',()=>{
    const original=lines();const snapshot=JSON.stringify(original);const sorted=bestManifestProducts(original);
    expect(JSON.stringify(original)).toBe(snapshot);expect(sorted[0].title).toBe('Plain widget');expect(sorted).not.toBe(original);
  });
  test('every extra cost/recovery field remains reachable',()=>{
    const exposed=new Set([...LOT_COST_GROUPS.flatMap(group=>group.fields.map(field=>field.key)),'currentBid','bidCount','minutesLeft','inbound','budget','targetProfit']);
    expect(Object.keys(DEFAULT_LOT_ASSUMPTIONS).every(key=>exposed.has(key))).toBe(true);
  });
});
describe('Experience source contracts (not device/render tests)',()=>{
  test('status copy is attached to actual file operations and does not claim market scraping',()=>{
    expect(source('services/manifestFileService.ts')).toContain("onProgress?.('reading')");
    expect(source('services/manifestFileService.ts')).toContain("onProgress?.('checking')");
    expect(source('hooks/useManifestOpportunity.ts')).toContain("setPhase('planning')");
    expect(JSON.stringify(MANIFEST_PHASES)).not.toMatch(/scrap|bestseller|verified sales/i);
    expect(source('components/feature/ManifestProgress.tsx')).not.toContain('setInterval(');
  });
  test('UI still uses shared calculations and saving, never live publication',()=>{
    const ui=source('components/feature/ManifestOpportunityWorkspace.tsx');
    expect(ui).toContain('useManifestOpportunity()');expect(ui).toContain('workflow.save()');
    expect(ui).not.toContain('submitListingToMarketplace');expect(ui).toContain('Nothing is bought or published automatically.');
  });
  test('account tab stays hidden outside Antique Flipper and becomes its More entry there',()=>expect(source('app/(tabs)/_layout.tsx')).toContain('href: nicheHome.isAntiques ? undefined : null'));
  test('all supplied branding files exist without creating a Tool product',()=>{
    const assets=['bike-flipper','mx-flipper','card-flipper','threads-flip','tool-flipper','antique-flipper','tech-flipper','beauty-flipper','fossil-flipper','coin-flipper'];
    assets.forEach(name=>expect(fs.existsSync(path.resolve(__dirname,`../../assets/images/brands/${name}.jpeg`))).toBe(true));
    expect(source('constants/brandArtwork.ts')).not.toContain("case 'tools'");
    expect(source('app/niche-select.tsx')).toContain('DESIGN PREVIEW · NOT AVAILABLE YET');
  });
});
