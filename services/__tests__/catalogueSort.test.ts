import { sortCatalogue,type CatalogueSort } from '../catalogueSortService';
const rows=[{id:'a',price:10,date:'2026-01-01',watchers:2,views:8},{id:'b',price:30,date:'2026-03-01',watchers:1,views:50},{id:'c',price:20,date:'2026-02-01',watchers:8,views:2}];
const values=(row:typeof rows[number])=>row;
test.each<[CatalogueSort,string[]]>([['newest',['b','c','a']],['oldest',['a','c','b']],['price_high',['b','c','a']],['price_low',['a','c','b']],['watchers',['c','a','b']],['views',['b','a','c']]])('%s orders actual metadata', (sort,expected)=>{expect(sortCatalogue(rows,sort,values).map(row=>row.id)).toEqual(expected);});
test('sorting never mutates the context snapshot',()=>{const copy=JSON.stringify(rows);sortCatalogue(Object.freeze([...rows]),'price_high',values);expect(JSON.stringify(rows)).toBe(copy);});
test('unknown prices stay last in either direction',()=>{const input=[{id:'unknown',price:null},{id:'known',price:10}];for(const order of ['price_low','price_high'] as const)expect(sortCatalogue(input,order,row=>row).map(row=>row.id)).toEqual(['known','unknown']);});
test('equal values keep original order',()=>{const input=[{id:'b',views:3},{id:'a',views:3}];expect(sortCatalogue(input,'views',row=>row)).toEqual(input);});
test('invalid dates remain last, not fabricated as newest',()=>{const input=[{id:'bad',date:'not-a-date'},{id:'good',date:'2026-01-01'}];expect(sortCatalogue(input,'newest',row=>row).map(row=>row.id)).toEqual(['good','bad']);});
