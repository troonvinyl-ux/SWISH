import fs from 'node:fs';
const registry=JSON.parse(fs.readFileSync('niche-modules.json','utf8'));
const owners=new Map();
for(const [id,module] of Object.entries(registry.products)) {
 if(id!==module.id || !module.specialists.includes(module.defaultSpecialist)) throw Error('Invalid canonical specialist contract: '+id);
 if(!fs.existsSync('app/'+module.entry) || !fs.existsSync('niches/'+id+'/module.json')) throw Error('Missing independent entry or descriptor: '+id);
 for(const specialist of [...module.specialists,...module.legacySpecialists]) {
  if(owners.has(specialist)&&owners.get(specialist)!==id) throw Error('Cross-niche specialist ownership: '+specialist);
  owners.set(specialist,id);
 }
 if(module.specialists.includes('curiosities_collectibles')) throw Error('Generic catch-all cannot be an unrestricted niche');
}
for(const route of ['index','scan','inventory','listings','account']) if(!fs.existsSync(`app/(tabs)/${route}.tsx`)) throw Error('Missing shared specialist footer: '+route);
const originalIds=['coins','motocross','bicycles','clothing','trading_cards','antiques','fossils','beauty','tech','surplus_flip','collectibles'];
if(originalIds.some(id=>!registry.products[id])||!registry.products.tunes_flip) throw Error('An existing module or Tunes Flip is missing');
console.log('Canonical '+Object.keys(registry.products).length+'-module source contracts validated. Runtime and device behavior are separate tests.');
