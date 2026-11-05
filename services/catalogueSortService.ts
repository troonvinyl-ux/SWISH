// Shared stable sorting: never mutates a context snapshot or changes account scope.
export type CatalogueSort = 'newest' | 'oldest' | 'price_high' | 'price_low' | 'watchers' | 'views';
export const CATALOGUE_SORT_OPTIONS: {id:CatalogueSort;label:string}[] = [
 {id:'newest',label:'Newest first'},{id:'oldest',label:'Oldest first'},
 {id:'price_high',label:'Price: high to low'},{id:'price_low',label:'Price: low to high'},
 {id:'watchers',label:'Most watchers'},{id:'views',label:'Most views'},
];
export interface CatalogueSortValues {price?:number|null;date?:string|null;watchers?:number|null;views?:number|null}
function number(value:unknown):number|null {if(value==null)return null;const result=Number(value);return Number.isFinite(result)?result:null;}
export function sortCatalogue<T>(items:readonly T[],order:CatalogueSort,values:(item:T)=>CatalogueSortValues):T[] {
 return items.map((item,index)=>({item,index,values:values(item)})).sort((a,b)=>{
  const key=order==='watchers'?'watchers':order==='views'?'views':order.startsWith('price')?'price':'date';
  const read=(row:CatalogueSortValues)=>key==='date'?number(row.date?Date.parse(row.date):null):number(row[key]);
  const left=read(a.values),right=read(b.values);
  if(left===null&&right!==null)return 1;if(right===null&&left!==null)return -1;
  const direction=order==='oldest'||order==='price_low'?1:-1;
  return (left!==null&&right!==null?(left-right)*direction:0)||a.index-b.index;
 }).map(row=>row.item);
}
