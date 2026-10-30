#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const niche = process.env.SWISH_NICHE || process.env.NICHE;
if (!niche) throw new Error('Set SWISH_NICHE to the branded app being built.');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'niche-modules.json'), 'utf8'));
if (!registry.products[niche]) throw new Error('Unknown SWISH_NICHE: ' + niche);

const entries = {
 coins:'entry/coins.tsx', motocross:'entry/motocross.tsx', bicycles:'entry/bicycles.tsx',
 clothing:'entry/clothing.tsx', trading_cards:'entry/cards.tsx', antiques:'entry/antiques.tsx',
 fossils:'entry/fossils.tsx', beauty:'entry/beauty.tsx', tech:'entry/tech.tsx',
 surplus_flip:'entry/surplus-flip.tsx'
};
const dedicated = {
 coins:['coin-flipper.tsx','keen-on-coins.tsx','islamic-batch.tsx','silver-batch.tsx'],
 motocross:['flipper-mx.tsx','mx-acquisition.tsx'], bicycles:['bike-flipper.tsx'],
 clothing:['threads-flip.tsx'], trading_cards:[], antiques:[], fossils:[], beauty:[], tech:[], surplus_flip:[]
};
const source = path.join(root,'app');
const output = path.join(root,'.swish-build',niche,'app');
fs.rmSync(path.dirname(output),{recursive:true,force:true});
fs.mkdirSync(output,{recursive:true});
const excluded = new Set(['niche-select.tsx']);
for (const [id,file] of Object.entries(entries)) if (id !== niche) excluded.add(file);
for (const [id,files] of Object.entries(dedicated)) if (id !== niche) for (const file of files) excluded.add(file);
if (niche !== 'coins') for (const file of dedicated.coins) excluded.add(file);
const removed = new Set();
function walk(src,dst) {
 for (const ent of fs.readdirSync(src,{withFileTypes:true})) {
  const full=path.join(src,ent.name), rel=path.relative(source,full).split(path.sep).join('/');
  if (ent.isDirectory()) {
   if (rel === 'entry') {
    const chosen=entries[niche], from=path.join(source,chosen);
    if (fs.existsSync(from)) { const target=path.join(output,'entry'); fs.mkdirSync(target,{recursive:true}); fs.copyFileSync(from,path.join(target,path.basename(chosen))); }
    continue;
   }
   const next=path.join(dst,ent.name); fs.mkdirSync(next,{recursive:true}); walk(full,next); continue;
  }
  if (excluded.has(rel)) { removed.add(rel.replace(/\.(tsx?|jsx?)$/,'')); continue; }
  fs.copyFileSync(full,path.join(dst,ent.name));
 }
}
walk(source,output);
const layout=path.join(output,'_layout.tsx');
if (fs.existsSync(layout)) {
 let text=fs.readFileSync(layout,'utf8');
 for (const route of removed) {
  const name=route.replace(/\.(tsx?)$/,'');
  text=text.split('\n').filter(line=>!line.includes('<Stack.Screen') || !line.includes('name="'+name+'"')).join('\n');
 }
 fs.writeFileSync(layout,text);
}
for (const [id,route] of Object.entries(entries)) {
 const exists=fs.existsSync(path.join(output,route));
 if (exists !== (id===niche)) throw new Error('Entry-route isolation failed for '+id);
}
if (niche!=='coins') for (const route of dedicated.coins) if (fs.existsSync(path.join(output,route))) throw new Error('Coin route leaked into '+niche+': '+route);
console.log('Prepared reduced route root for '+niche+' at '+output+'; removed '+removed.size+' niche-specific routes.');
