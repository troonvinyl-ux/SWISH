#!/usr/bin/env node
'use strict';
// AST traversal covers static imports, re-exports, dynamic imports and require.
const fs = require('node:fs'); const path = require('node:path'); const ts = require('typescript');
const root = path.resolve(__dirname,'..'); const registry = require('../niche-modules.json');
const niche = process.env.SWISH_NICHE || process.env.NICHE; const product = registry.products[niche];
if (!product) throw new Error('Registered niche required');
const generated = path.join(root,'.swish-build',niche,'app');
const allowed = new Set([...(product.buildSharedRoutes ?? registry.sharedRoutes),product.entry,product.home,...product.dedicatedRoutes].filter(Boolean));
const routes = [];
function walk(dir) { for(const entry of fs.readdirSync(dir,{withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isDirectory()) walk(file); else routes.push(file); } }
walk(generated);
for(const file of routes) if(!allowed.has(path.relative(generated,file).split(path.sep).join('/'))) throw new Error('Unexpected generated route: '+file);
for(const route of allowed) if(!routes.includes(path.join(generated,route))) throw new Error('Missing route: '+route);
function resolve(from,specifier) {
  if(!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base=specifier.startsWith('@/') ? path.join(root,specifier.slice(2)) : path.resolve(path.dirname(from),specifier);
  const candidates=[base,...['.ts','.tsx','.js','.jsx','.json','.png','.jpg','.jpeg','.webp'].map(ext=>base+ext),...['.ts','.tsx','.js'].map(ext=>path.join(base,'index'+ext))];
  const found=candidates.find(file=>fs.existsSync(file)&&fs.statSync(file).isFile());
  if(!found) throw new Error('Unresolved local import '+specifier+' from '+path.relative(root,from));
  return found;
}
const visited=new Set(); const assets=[]; const pending=[...routes];
while(pending.length) {
 const file=pending.pop(); if(visited.has(file)) continue; visited.add(file);
 if(file.startsWith(path.join(root,'app')+path.sep)) {
  const route=path.relative(path.join(root,'app'),file).split(path.sep).join('/');
  if(!allowed.has(route)) throw new Error('Foreign route reached through imports: '+route);
 }
 if(!/\.[jt]sx?$/.test(file)) { assets.push(path.relative(root,file)); continue; }
 const text=fs.readFileSync(file,'utf8'); const tree=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,file.endsWith('x')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 function visit(node) {
  let spec=null;
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) spec=node.moduleSpecifier.text;
  if(ts.isCallExpression(node) && (node.expression.kind===ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression)&&node.expression.text==='require'))) {
   if(node.arguments.length!==1 || !ts.isStringLiteral(node.arguments[0])) throw new Error('Computed module dependency requires explicit review: '+file);
   spec=node.arguments[0].text;
  }
  if(spec) { const resolved=resolve(file,spec); if(resolved) pending.push(resolved); }
  ts.forEachChild(node,visit);
 }
 visit(tree);
}
const report={niche,androidPackage:product.androidPackage,routes:routes.map(file=>path.relative(generated,file)),localModules:[...visited].map(file=>path.relative(root,file)),assets,scope:'Physical route and local dependency closure. This does not certify final Hermes bundle/native dependency exclusion or device acceptance.'};
fs.writeFileSync(path.join(root,'.swish-build',niche,'import-closure.json'),JSON.stringify(report,null,2));
console.log('Route/import closure checked: '+niche+' ('+routes.length+' routes, '+visited.size+' local modules).');
