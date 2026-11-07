// Session-local reuse, never an offline provider catalogue or an authorization cache.
export function createQuickReuse<T>(ttlMs:number,limit=32){
 const entries=new Map<string,{expiresAt:number;promise:Promise<T>}>();
 return {
  get(key:string,load:()=>Promise<T>,usable:(value:T)=>boolean=()=>true):Promise<T>{
   const cached=entries.get(key);if(cached&&cached.expiresAt>Date.now())return cached.promise;
   const entry={expiresAt:Date.now()+ttlMs,promise:Promise.resolve(null as unknown as T)};
   const remove=()=>{if(entries.get(key)===entry)entries.delete(key);};
   entry.promise=Promise.resolve().then(load).then(value=>{if(!usable(value))remove();return value;},cause=>{remove();throw cause;});
   entries.set(key,entry);while(entries.size>limit)entries.delete(entries.keys().next().value!);return entry.promise;
  },
  clear(){entries.clear();},
 };
}
export function quickSemanticKey(value:unknown):string{
 const stable=(input:unknown):unknown=>Array.isArray(input)?input.map(stable):input&&typeof input==='object'?Object.fromEntries(Object.entries(input).filter(([,entry])=>entry!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,entry])=>[key,stable(entry)])):input;
 return JSON.stringify(stable(value));
}
