// Bounded independent READS only. All active workers settle before a failure escapes.
// No automatic provider retry, rate-limit bypass or mutation concurrency.
export async function mapSyncReads<T,R>(values: readonly T[], operation: (value:T,index:number)=>Promise<R>, concurrency=3): Promise<R[]> {
 const output:R[]=new Array(values.length);let next=0,failed=false;let failure:unknown=null;
 const worker=async()=>{while(!failed){const index=next++;if(index>=values.length)return;try{output[index]=await operation(values[index],index);}catch(cause){failed=true;failure=cause;}}};
 await Promise.all(Array.from({length:Math.min(Math.max(1,Math.floor(concurrency)),3,values.length)},()=>worker()));
 if(failed)throw failure;
 return output;
}
function stable(value:unknown):unknown {
 if(Array.isArray(value))return value.map(stable);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,stable(entry)]));
 return value;
}
export function syncPatchChanged(row:Record<string,unknown>,patch:Record<string,unknown>):boolean {
 return Object.entries(patch).some(([key,value])=>JSON.stringify(stable(row[key]))!==JSON.stringify(stable(value)));
}

/** JSON persistence returns *new objects*, not the in-memory media references.
 * Preserve original structured photos and compare values, not object identity. */
export function photoMediaReadbackComplete(expected: readonly unknown[], persisted: unknown): boolean {
 if(!Array.isArray(persisted))return expected.length===0;
 const saved=new Set(persisted.map(value=>JSON.stringify(stable(value))));
 return expected.every(value=>saved.has(JSON.stringify(stable(value))));
}

/** Bounded, disjoint-item reconciliation. Only different stock IDs can be written
 * concurrently; multiple eBay listings belonging to one physical item are
 * processed in their original order, with a fresh stock read after the first.
 * Never retries a write. Unexpected rejections drain all in-flight workers
 * before propagating uncertainty, so a handler cannot finish mid-mutation. */
export async function mapDistinctSyncItems<T,R>(
 values: readonly T[],
 itemKey: (value:T)=>string,
 operation: (value:T,previousInItem:boolean,index:number)=>Promise<R>,
 concurrency=2,
): Promise<R[]> {
 const groups=new Map<string,Array<{value:T;index:number}>>();
 values.forEach((value,index)=>{
  const key=itemKey(value);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key)!.push({value,index});
 });
 const ordered=[...groups.values()],output=new Array<R>(values.length);
 let next=0,failed=false,failure:unknown=null;
 const worker=async()=>{
  while(!failed){
   const index=next++;if(index>=ordered.length)return;
   for(const [withinItem,entry] of ordered[index].entries()){
    if(failed)return;
    try{output[entry.index]=await operation(entry.value,withinItem>0,entry.index);}
    catch(cause){failed=true;failure=cause;return;}
   }
  }
 };
 await Promise.all(Array.from({length:Math.min(Math.max(1,Math.floor(concurrency)),2,ordered.length)},()=>worker()));
 if(failed)throw failure;
 return output;
}
