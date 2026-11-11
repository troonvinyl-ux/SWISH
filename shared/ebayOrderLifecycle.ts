/** One order lifecycle for every niche. Payment, shipping and delivery are separate evidence. */
export type SellerOrderStage='awaiting_payment'|'awaiting_dispatch'|'packing'|'label_created'|'dispatched'|'delivered'|'completed'|'cancelled'|'returned';
export interface EbayOrderEvidence { payment:string; fulfillment?:string; cancelled?:boolean; shippedAt?:string|null; deliveredAt?:string|null; trackingNumber?:string; carrier?:string }
export function ebayOrderLifecycle(e:EbayOrderEvidence){
 const payment=e.payment.toUpperCase();
 if(e.cancelled)return {status:'cancelled',fulfilmentStatus:'cancelled' as SellerOrderStage,paid:false,requiresAction:false,action:null};
 if(payment==='FULLY_REFUNDED')return {status:'returned',fulfilmentStatus:'returned' as SellerOrderStage,paid:false,requiresAction:false,action:null};
 const paid=payment==='PAID';
 if(!paid)return {status:'pending',fulfilmentStatus:'awaiting_payment' as SellerOrderStage,paid:false,requiresAction:false,action:'Awaiting confirmed eBay payment'};
 // A tracking number, order age, fulfilment acknowledgement or expected delivery date never proves delivery.
 const delivered=Boolean(e.deliveredAt&&Number.isFinite(Date.parse(e.deliveredAt)));
 const shipped=Boolean(e.shippedAt&&Number.isFinite(Date.parse(e.shippedAt)))||e.fulfillment?.toUpperCase()==='FULFILLED';
 return {status:delivered?'delivered':shipped?'dispatched':'payment_received',fulfilmentStatus:(delivered?'delivered':shipped?'dispatched':'awaiting_dispatch') as SellerOrderStage,paid:true,requiresAction:!delivered&&!shipped,action:!delivered&&!shipped?'Pack and dispatch this paid order':null};
}
export function sellerOrderStage(row:{status?:string;fulfilment_status?:string;ebay_payment_status?:string|null}):SellerOrderStage{
 if(row.status==='cancelled'||row.fulfilment_status==='cancelled')return 'cancelled';
 if(row.ebay_payment_status==='FULLY_REFUNDED'||row.status==='returned'||row.fulfilment_status==='returned')return 'returned';
 if(row.ebay_payment_status&&row.ebay_payment_status!=='PAID')return 'awaiting_payment';
 if(row.fulfilment_status==='awaiting_payment'||row.status==='pending')return 'awaiting_payment';
 return (['awaiting_dispatch','packing','label_created','dispatched','delivered','completed'].includes(row.fulfilment_status??'')?row.fulfilment_status:'awaiting_dispatch') as SellerOrderStage;
}
