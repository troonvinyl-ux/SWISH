// Pure inventory ordering and evidence-backed price presentation; no network or React.
import type { InventoryViewItem } from './inventoryViewService';
export type InventoryOrder = 'newest' | 'oldest' | 'title' | 'price_high' | 'price_low' | 'watchers' | 'views';
export const inventoryOrderOptions: ReadonlyArray<{id:InventoryOrder;label:string}> = [
 {id:'newest',label:'Newest first'},{id:'oldest',label:'Oldest first'},{id:'title',label:'Name A–Z'},
 {id:'price_high',label:'Price high–low'},{id:'price_low',label:'Price low–high'},
 {id:'watchers',label:'Most watchers'},{id:'views',label:'Most views'},
];
export function inventoryPrice(item:InventoryViewItem):number {
 const value=item.inventoryTab==='sold'?item.soldPrice:item.listing?.price??item.expectedSellingPrice??item.valuationMid;
 return Number.isFinite(Number(value))?Number(value):0;
}
/** Recommendation is the saved selling-price estimate, never an invented discount or a realised sale. */
export function recommendedInventoryPrice(item:InventoryViewItem):number|null {
 const price=Number(item.expectedSellingPrice),current=Number(item.listing?.price);
 if(!Number.isFinite(price)||price<=0||!Number.isFinite(current)||current<=0||Math.round(price*100)===Math.round(current*100))return null;
 const floor=Number(item.listing?.floorPrice??0),ceiling=Number(item.listing?.ceilingPrice??0);
 if(price<floor||(ceiling>0&&price>ceiling))return null;
 return Math.round(price*100)/100;
}
export function orderInventory(items:readonly InventoryViewItem[],order:InventoryOrder):InventoryViewItem[] {
 const time=(item:InventoryViewItem)=>{const value=Date.parse(item.createdAt??'');return Number.isFinite(value)?value:0;};
 return [...items].sort((a,b)=>{
  let difference=0;
  if(order==='title')difference=a.canonical_title.localeCompare(b.canonical_title,undefined,{sensitivity:'base',numeric:true});
  else if(order==='oldest')difference=time(a)-time(b);
  else if(order==='price_high')difference=inventoryPrice(b)-inventoryPrice(a);
  else if(order==='price_low')difference=inventoryPrice(a)-inventoryPrice(b);
  else if(order==='watchers')difference=Number(b.listing?.watchers??0)-Number(a.listing?.watchers??0);
  else if(order==='views')difference=Number(b.listing?.views??0)-Number(a.listing?.views??0);
  else difference=time(b)-time(a);
  return difference||a.id.localeCompare(b.id);
 });
}
