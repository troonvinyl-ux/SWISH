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
