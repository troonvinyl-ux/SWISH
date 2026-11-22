import { mapDistinctSyncItems } from '../functions/_shared/syncConcurrency.ts';

Deno.test('different stock items reconcile two at a time while same-item eBay links stay ordered', async () => {
 const rows=[
  { item:'A',listing:'A1' }, { item:'B',listing:'B1' },
  { item:'A',listing:'A2' }, { item:'C',listing:'C1' },
  { item:'B',listing:'B2' }, { item:'D',listing:'D1' },
 ];
 let active=0,maxActive=0;
 const inProgress=new Set<string>(),completed:string[]=[];
 const values=await mapDistinctSyncItems(rows,row=>row.item,async(row,previous)=>{
  if(inProgress.has(row.item))throw new Error('Same physical item overlapped');
  if(previous && !completed.some(s=>s.startsWith(row.item)))throw new Error('Linked listing processed before previous stock update');
  inProgress.add(row.item);active++;maxActive=Math.max(maxActive,active);
  await new Promise(resolve=>setTimeout(resolve,5));
  active--;inProgress.delete(row.item);completed.push(row.listing);
  return row.listing;
 },100);
 if(maxActive!==2)throw new Error('Independent stock writes should use exactly two bounded workers');
 if(active!==0||inProgress.size)throw new Error('Writes left in flight');
 if(values.join(',')!==rows.map(x=>x.listing).join(','))throw new Error('Input listing order changed');
 if(completed.indexOf('A2')<completed.indexOf('A1')||completed.indexOf('B2')<completed.indexOf('B1'))
  throw new Error('Same-item listing order not preserved');
});

Deno.test('a failed stock write is never retried and all started workers settle before uncertainty escapes', async () => {
 const rows=[{item:'A',listing:'A1'},{item:'B',listing:'B1'},{item:'A',listing:'A2'},{item:'C',listing:'C1'}];
 const attempts=new Map<string,number>();let active=0;
 let rejected=false;
 try{
  await mapDistinctSyncItems(rows,row=>row.item,async row=>{
   attempts.set(row.listing,(attempts.get(row.listing)||0)+1);
   active++;
   await new Promise(resolve=>setTimeout(resolve,5));
   active--;
   if(row.listing==='A1')throw new Error('Unconfirmed stock persistence');
   return row.listing;
  });
 }catch(error){rejected=error instanceof Error && error.message==='Unconfirmed stock persistence';}
 if(!rejected||active!==0)throw new Error('Failure must wait for all active workers and propagate');
 if([...attempts.values()].some(count=>count!==1))throw new Error('Unexpected stock write replay');
 if(attempts.has('A2'))throw new Error('Cannot process another listing of a failed stock item');
});

Deno.test('empty inputs do not schedule work',async()=>{
 let calls=0;
 const values=await mapDistinctSyncItems([] as string[],value=>value,async value=>{calls++;return value;});
 if(values.length!==0||calls!==0)throw new Error('Empty sync scheduled a write');
});
