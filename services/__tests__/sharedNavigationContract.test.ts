import fs from 'node:fs';
import path from 'node:path';
const source=(file:string)=>fs.readFileSync(path.resolve(__dirname,'../..',file),'utf8');
describe('Shared unified five-area navigation contract',()=>{
 const layout=source('app/(tabs)/_layout.tsx');
 test('all niches keep ordered Home, Inventory, Camera, Listings and More',()=>{
  const names=['index','inventory','scan','listings','account'];
  const offsets=names.map(name=>layout.indexOf(`name="${name}"`));
  expect(offsets.every(value=>value>=0)).toBe(true);expect(offsets).toEqual([...offsets].sort((a,b)=>a-b));
  for(const [label,icon] of [['Home','home'],['Inventory','inventory-2'],['Listings','sell'],['More','menu']])expect(layout).toContain(`tabIcon('${label}','${icon}'`);
 });
 test('niche brand accent and safe-area footer remain shared',()=>{
  expect(layout).toContain('NICHES[id].color');expect(layout).toContain('Colors.specialistGold');
  expect(layout).toContain('backgroundColor:accent');expect(layout).toContain('insets.bottom+60');
 });
 test('More uses the common specialist menu and preserves Antique tools',()=>{
  expect(source('app/(tabs)/account.tsx')).toContain('<ModuleMore');
  const more=source('components/feature/ModuleMore.tsx');expect(more).toContain('Antique Guides');expect(more).toContain('Restoration & Care');
  expect(more).toContain('/settings');expect(more).toContain('/subscription');
 });
 test('single-niche subscribers do not get a switcher or owner actions',()=>{
  const more=source('components/feature/ModuleMore.tsx');expect(more).toContain('shell.canSwitchNiche');
  expect(more).toContain('shell.isMasterAdmin && !shell.fixedNicheId');
  expect(source('app/(tabs)/account.tsx')).not.toContain('isSwishMasterAdmin(user?.email)');
 });
 test('listing context uses fixed build identity before active selection',()=>{
  expect(source('app/(tabs)/listings.tsx')).toContain('fixedNicheId??activeNicheId');
 });
});
