import fs from 'node:fs';
import path from 'node:path';
import { selectNumistaFaces, jpegDimensions, validateNumistaImages, numistaPhysicalContradictions, numistaSearchTrail, type NumistaImageSearchResult } from '../../shared/numistaImageSearch';
const read = (file: string) => fs.readFileSync(path.resolve(__dirname, '../..', file), 'utf8');
const jpeg = (width: number, height: number) => Buffer.from([255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,0,3,17,0,255,217]).toString('base64');
const image = { mime_type: 'image/jpeg', image_data: jpeg(768,1024), width: 768, height: 1024, label: 'Obverse' };
describe('Numista original-face search policy', () => {
  test('selects obverse and reverse regardless of capture insertion order, not studio/detail images', () => {
    const edge = { uri:'file://edge.jpg',slotId:'edge',slotLabel:'Edge' };
    const reverse = { uri:'file://reverse.jpg',slotId:'reverse',slotLabel:'Reverse' };
    const obverse = { uri:'file://obverse.jpg',slotId:'obverse',slotLabel:'Obverse', enhancedUri:'file://generated.jpg' };
    expect(selectNumistaFaces([edge,reverse,obverse])).toEqual([obverse,reverse]);
    expect(selectNumistaFaces([obverse,obverse])).toEqual([obverse]);
    expect(selectNumistaFaces([])).toEqual([]);
  });
  test('stored originals work without pretending their face order is known', () => {
    const photos = [1,2,3,4].map(index => ({ uri:`https://storage.example/original-${index}.jpg` }));
    expect(selectNumistaFaces(photos)).toEqual(photos.slice(0,2));
  });
  test('JPEG actual long-edge dimensions must match declared dimensions and provider limit', () => {
    expect(jpegDimensions(image.image_data)).toEqual({ width:768,height:1024 });
    expect(validateNumistaImages([image,image])).toBeNull();
    expect(validateNumistaImages([image,image,image])).toMatch(/two/);
    expect(validateNumistaImages([{...image,width:100}])).toMatch(/1024/);
    expect(validateNumistaImages([{...image,image_data:jpeg(1025,1024),width:1025}])).toMatch(/1024/);
    expect(validateNumistaImages([{...image,image_data:'YQ=='}])).not.toBeNull();
    expect(validateNumistaImages([{...image,image_data:'https://internal/photo.jpg'}])).not.toBeNull();
  });
  test('image relevance can never remove hard physical contradictions', () => {
    expect(numistaPhysicalContradictions({weight:10,size:25},5,30)).toHaveLength(2);
    expect(numistaPhysicalContradictions({weight:10,size:25},9.5,26)).toEqual([]);
    expect(numistaPhysicalContradictions({},5,30)).toEqual([]);
  });
  test('new retained evidence contains identifiers and operational facts only', () => {
    const result:NumistaImageSearchResult = {status:'results',source:'Numista',imageCount:2,message:'Leads',candidates:[{typeId:12,numistaN:'N#12',title:'Licensed title',rank:1,url:'https://en.numista.com/12'}]};
    const trail = numistaSearchTrail(result);
    expect(trail.candidateIds).toEqual([12]);
    expect(JSON.stringify(trail)).not.toContain('Licensed title');
    expect(read('services/captureDraftService.ts')).toContain('numistaImageSearch: undefined');
  });
  test('shared scanner and saved-photo re-ID use the same server-only gateway', () => {
    const edge = read('supabase/functions/swish-identify/index.ts');
    expect(edge.indexOf('let visualCatalogue: Record<string, any>[] = []')).toBeGreaterThan(edge.indexOf('const { isPremium, source: premiumSource'));
    expect(edge).toContain('shouldRunNumista(objectType)');
    expect(edge).toContain('JSON.stringify(imageCatalogueReview(visualCatalogue');
    expect(edge).toContain('candidate.id === Number(reviewed.numistaTypeId)');
    expect(edge).toContain('numistaPhysicalContradictions(detail ?? item.candidate');
    expect(edge).toContain('const queriesToTry = imageCatalogue.length ? [] : [...querySet].slice(0, 4);');
    expect(edge).toContain('for (const q of queriesToTry)');
    for(const file of ['components/feature/PremiumScanner.tsx','app/stock-listing/[id].tsx']) expect(read(file)).toContain('NumistaImageSearchCard');
    const client = read('services/numistaImagePreparationService.ts');
    expect(client).not.toMatch(/NUMISTA_API_KEY|Numista-API-Key|functions\.invoke|enhancedUri|\.studio/);
    const ui = read('components/feature/NumistaImageSearchCard.tsx');
    expect(ui).toContain('Source: Numista');expect(ui).toContain('{item.numistaN}');expect(ui).toContain('not an identification confidence score');
    expect(ui).not.toMatch(/functions\.invoke|getSupabaseClient/);
  });
  test('deployable and client policy mirrors match', () => expect(read('shared/numistaImageSearch.ts')).toBe(read('supabase/functions/_shared/numistaImageSearch.ts')));
});
