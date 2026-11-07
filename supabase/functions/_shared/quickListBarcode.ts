// eBay Browse product discovery through the EXISTING eBay application-token path.
// Seller data is a lead, never an exact-product/condition certificate. No product images are copied.
export async function lookupBarcodeProducts(token:string,gtin:string,requestFetch:typeof fetch=fetch){
 const headers={Authorization:`Bearer ${token}`,'X-EBAY-C-MARKETPLACE-ID':'EBAY_GB',Accept:'application/json'};
 const response=await requestFetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?gtin=${encodeURIComponent(gtin)}&limit=6`,{headers,signal:AbortSignal.timeout(8000)});
 if(!response.ok)return {products:[],status:'unavailable',message:`eBay barcode lookup HTTP ${response.status}. Use photo identification.`};
 const data=await response.json();
 const summaries=Array.isArray(data.itemSummaries)?data.itemSummaries.slice(0,6):[];
 const details=await Promise.all(summaries.map(async(row:any)=>{if(typeof row.itemId!=='string'||!/^v1\|\d+\|\d+$/.test(row.itemId))return null;try{const response=await requestFetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(row.itemId)}`,{headers,signal:AbortSignal.timeout(5000)});if(!response.ok)return null;const item=await response.json();if(typeof item.gtin!=='string'||item.gtin.padStart(14,'0')!==gtin.padStart(14,'0')||!item.title)return null;
 const specifics:Record<string,string>={};for(const field of item.localizedAspects??[])if(typeof field.name==='string'&&typeof field.value==='string'&&field.name.length<=65&&field.value.length<=65&&!/condition|seller|warranty/i.test(field.name))specifics[field.name]=field.value;
 const brand=String(item.brand??specifics.Brand??''),model=String(item.mpn??specifics.Model??'');
 return {id:String(item.itemId),title:String(item.title).slice(0,180),gtin:item.gtin,brand,model,categoryId:String(item.categoryId??''),categoryName:String(item.categoryPath??''),specifics,source:'eBay Browse',url:String(item.itemWebUrl??'')};}catch{return null;}}));
 // Merge only identical variant attributes, never merely similar titles.
 const unique=new Map<string,any>();for(const product of details)if(product){const variant=JSON.stringify([product.title,product.brand,product.model,Object.entries(product.specifics).sort(([a],[b])=>a.localeCompare(b))]);if(!unique.has(variant))unique.set(variant,product);}
 return {products:[...unique.values()],status:unique.size?'candidates':'no_match',message:unique.size?'Confirm the physical product and variant; barcode does not prove condition.':'No exact GTIN was verified. Photo identification is available immediately.'};
}
