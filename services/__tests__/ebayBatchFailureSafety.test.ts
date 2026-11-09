jest.mock('@/template',()=>({getSupabaseClient:jest.fn()}));
import {getSupabaseClient} from '@/template';
import {runNicheEbayOperation} from '../ebaySyncService';
import fs from 'node:fs';
test('an arbitrary completion flag cannot bypass an unconfirmed failure',async()=>{const invoke=jest.fn().mockResolvedValue({data:{success:false,batchComplete:true,error:'unconfirmed readback',processed:6,failed:1,blocked:0,nextAfterListingId:'00000000-0000-4000-8000-000000000001'},error:null});(getSupabaseClient as jest.Mock).mockReturnValue({functions:{invoke}});const result=await runNicheEbayOperation('tenant','coins','sync');expect(result.error).toBe('unconfirmed readback');expect(invoke).toHaveBeenCalledTimes(1);});
test('outcome logging failure disables continuation and earlier restrictions suppress full-sync timestamp',()=>{const edge=fs.readFileSync('supabase/functions/swish-ebay-sync/index.ts','utf8');expect(edge).toContain('success:false,batchComplete:false,partial:true,error:\'SWISH sync outcome logging');expect(edge).toContain('!nextAfterListingId&&!previousIssues');expect(fs.readFileSync('services/ebaySyncService.ts','utf8')).toContain('previousIssues: true');});
