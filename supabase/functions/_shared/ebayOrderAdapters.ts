import { XMLParser,XMLValidator } from 'npm:fast-xml-parser@4.5.3';
import { ebayOrderLifecycle } from './ebayOrderLifecycle.ts';
const scalar=(value:any):string=>typeof value==='object'&&value!==null?String(value['#text']??''):String(value??'');
const array=(value:any):any[]=>value==null?[]:Array.isArray(value)?value:[value];
const date=(value:any):string|null=>{const text=scalar(value);return text&&Number.isFinite(Date.parse(text))?new Date(text).toISOString():null;};
const money=(value:any):number=>{const n=Number(scalar(value?.value??value));if(!Number.isFinite(n)||n<0)throw new Error('Invalid eBay amount');return Math.round(n*100)/100;};
export interface OrderLineEvidence {orderId:string;aliases:string[];lineKey:string;lineId:string;legacyItemId:string;quantity:number;amount:number;shipping:number;createdAt:string;modifiedAt:string|null;buyerName:string;buyerEmail:string|null;buyerAddress:Record<string,string>;payment:string;status:string;fulfilmentStatus:string;paid:boolean;requiresAction:boolean;action:string|null;shippedAt:string|null;deliveredAt:string|null;trackingNumber:string;carrier:string;source:string;shippingCheck?:boolean}
/** Exact known line totals only. Neither adapter spreads an unexplained cart total across item records. */
function verifyAllocation(lines:OrderLineEvidence[],total:any){if(lines.length>1&&Math.abs(lines.reduce((sum,line)=>sum+line.amount,0)-money(total))>0.02)throw new Error('Multi-line discounts/taxes require explicit allocation; no whole-order value was assigned to a single item');}
export function fulfillmentOrderLines(order:any):OrderLineEvidence[]{
 const createdAt=date(order.creationDate??order.createdAt);
 if(!order.orderId||!Array.isArray(order.lineItems)||!order.lineItems.length||!createdAt)throw new Error('eBay order identity or creation date missing');
 if(order.pricingSummary?.total?.currency&&order.pricingSummary.total.currency!=='GBP')throw new Error('Non-GBP order requires currency review');
 const ship=order.fulfillmentStartInstructions?.find((value:any)=>value.shippingStep?.shipTo)?.shippingStep?.shipTo,addr=ship?.contactAddress;
 const payment=String(order.orderPaymentStatus??'UNKNOWN'),cancelled=order.cancelStatus?.cancelState==='CANCELED';
 const lines:OrderLineEvidence[]=order.lineItems.map((li:any)=>{
  if(!li.legacyItemId||!li.lineItemId||!Number.isSafeInteger(li.quantity)||li.quantity<1)throw new Error('Order line identity/quantity missing');
  if(li.lineItemCost?.currency&&li.lineItemCost.currency!=='GBP')throw new Error('Order currency requires review');
  const shipping=money(li.deliveryCost?.shippingCost??0),ff=li.lineItemFulfillmentStatus??order.orderFulfillmentStatus;
  return {orderId:String(order.orderId),aliases:[order.orderId,order.legacyOrderId].filter(Boolean).map(String),lineKey:li.legacyTransactionId?`${li.legacyItemId}:${li.legacyTransactionId}`:`rest:${li.lineItemId}`,lineId:String(li.lineItemId),legacyItemId:String(li.legacyItemId),quantity:li.quantity,amount:order.lineItems.length===1?money(order.pricingSummary?.total):Math.round((money(li.lineItemCost)+shipping)*100)/100,shipping,createdAt,modifiedAt:date(order.lastModifiedDate??order.lastUpdatedAt),buyerName:ship?.fullName??order.buyer?.username??'',buyerEmail:null,buyerAddress:addr?{name:ship?.fullName??'',street:addr.addressLine1??'',street2:addr.addressLine2??'',city:addr.city??'',county:addr.stateOrProvince??'',postcode:addr.postalCode??'',country:addr.countryCode??''}:{},payment,...ebayOrderLifecycle({payment,cancelled,fulfillment:ff}),shippedAt:null,deliveredAt:null,trackingNumber:'',carrier:'',source:'fulfillment_rest',shippingCheck:['IN_PROGRESS','FULFILLED'].includes(ff)};
 });
 verifyAllocation(lines,order.pricingSummary?.total);return lines;
}
export function tradingOrderPage(xml:string):{lines:OrderLineEvidence[];pages:number;errors:string[]}{
 if(xml.length>10_000_000||XMLValidator.validate(xml)!==true)throw new Error('Invalid eBay GetOrders XML');
 const root=new XMLParser({ignoreAttributes:false,parseTagValue:false,removeNSPrefix:true,processEntities:true}).parse(xml).GetOrdersResponse;
 if(!root||!['Success','Warning'].includes(scalar(root.Ack)))throw new Error('eBay GetOrders did not succeed');
 const pages=Number(scalar(root.PaginationResult?.TotalNumberOfPages)||1);if(!Number.isSafeInteger(pages)||pages<0||pages>20)throw new Error('GetOrders pagination exceeds supported limit');
 const lines:OrderLineEvidence[]=[],errors:string[]=[];
 for(const order of array(root.OrderArray?.Order))try{
  const txs=array(order.TransactionArray?.Transaction),orderId=scalar(order.OrderID),createdAt=date(order.CreatedTime);
  if(!orderId||!createdAt||!txs.length)throw new Error('Missing order/transaction identity');
  const orderLines:OrderLineEvidence[]=txs.map(tx=>{
   const itemId=scalar(tx.Item?.ItemID),transaction=scalar(tx.TransactionID),quantity=Number(scalar(tx.QuantityPurchased)||1);
   if(!itemId||!transaction||!Number.isSafeInteger(quantity)||quantity<1)throw new Error('Missing transaction identity');
   if((tx.TransactionPrice?.['@_currencyID']&&tx.TransactionPrice['@_currencyID']!=='GBP')||(order.Total?.['@_currencyID']&&order.Total['@_currencyID']!=='GBP'))throw new Error('Non-GBP order requires review');
   const paidAt=date(tx.PaidTime??order.PaidTime),shippedAt=date(tx.ShippedTime??order.ShippedTime),details=tx.ShippingDetails??order.ShippingDetails??{},deliveredAt=date(details.ShipmentDeliveryDetails?.ActualDeliveryTime),tracking=array(details.ShipmentTrackingDetails)[0]??{};
   const payment=paidAt?'PAID':'UNPAID',state=scalar(order.OrderStatus),shipping=txs.length===1?money(order.ShippingServiceSelected?.ShippingServiceCost??0):money(tx.ActualShippingCost??tx.ShippingServiceSelected?.ShippingServiceCost??0);
   if(txs.length>1&&tx.ActualShippingCost===undefined&&tx.ShippingServiceSelected?.ShippingServiceCost===undefined&&money(order.ShippingServiceSelected?.ShippingServiceCost??0)>0)throw new Error('Multi-line shipping allocation unavailable');
   const amount=txs.length===1?money(order.Total??order.AmountPaid):Math.round((money(tx.TransactionPrice)*quantity+shipping)*100)/100,address=order.ShippingAddress??{};
   return {orderId,aliases:[orderId],lineKey:`${itemId}:${transaction}`,lineId:'',legacyItemId:itemId,quantity,amount,shipping,createdAt,modifiedAt:date(order.ModifiedTime),buyerName:scalar(address.Name)||scalar(order.BuyerUserID),buyerEmail:scalar(tx.Buyer?.Email)||null,buyerAddress:{name:scalar(address.Name),street:scalar(address.Street1),street2:scalar(address.Street2),city:scalar(address.CityName),county:scalar(address.StateOrProvince),postcode:scalar(address.PostalCode),country:scalar(address.Country)},payment,...ebayOrderLifecycle({payment,cancelled:['Cancelled','Canceled'].includes(state),shippedAt,deliveredAt}),shippedAt,deliveredAt,trackingNumber:scalar(tracking.ShipmentTrackingNumber),carrier:scalar(tracking.ShippingCarrierUsed),source:'trading_xml'};
  });
  verifyAllocation(orderLines,order.Total??order.AmountPaid);lines.push(...orderLines);
 }catch(cause){errors.push(cause instanceof Error?cause.message:'Order parse failed');}
 return {lines,pages:Math.max(1,pages),errors};
}
