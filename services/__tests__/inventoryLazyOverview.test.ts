// Node-only hook orchestration harness, not a native rendering/device test.
const mockSetState = jest.fn();
const mockFocus: Array<() => void> = [];
let mockState: any;
let mockSeed: any = null;
jest.mock('react', () => ({
 useState: (initial: any) => { mockState=mockSeed??initial; return [mockState,(next: any)=>{mockState=typeof next==='function'?next(mockState):next;mockSetState(mockState);}]; },
 useRef: (value: any) => ({current:value}),
 useCallback: (fn: any) => fn,
 useMemo: (fn: any) => fn(),
 useEffect: (fn: any) => {fn();},
}));
jest.mock('expo-router', () => ({useFocusEffect:(fn:()=>void)=>mockFocus.push(fn)}));
jest.mock('@/template', () => ({useAuth:()=>({user:{id:'user'}})}));
jest.mock('@/hooks/useApp', () => ({useApp:()=>({tenant:{id:'tenant'},activeNicheId:'coins',fixedNicheId:null,inventoryReloadSignal:0,subscriptionLoading:false,accessReady:true,moduleLoading:false,moduleEpoch:1,accessError:null,tenantError:null})}));
jest.mock('@/services/itemService', () => ({listItems:jest.fn(),getItemStatusCounts:jest.fn()}));
jest.mock('@/services/nicheRouting', () => ({getProductionNicheSpecialistIds:()=>['coins']}));
jest.mock('@/services/performanceMonitoringService', () => ({recordPrevention:jest.fn()}));
jest.mock('@/services/canonicalInventoryService', () => ({readCanonicalInventoryCounts:jest.fn(),emptyCanonicalCounts:()=>({total:0,units:0,stock:0,draft:0,live:0,sold:0,archived:0,liveListings:0})}));
import {useInventory} from '@/hooks/useInventory';
import {readCanonicalInventoryCounts} from '../canonicalInventoryService';
import {listItems,getItemStatusCounts} from '../itemService';
const counts={total:250,units:250,stock:22,draft:8,live:206,sold:14,archived:0,liveListings:206,revision:'a'.repeat(32),statusCounts:{identified:30,listed:206,sold:14}};
beforeEach(()=>{
 jest.clearAllMocks();mockFocus.length=0;mockSeed=null;
 (readCanonicalInventoryCounts as jest.Mock).mockResolvedValue(counts);
 (listItems as jest.Mock).mockResolvedValue({items:[{id:'coin'}],error:null});
 (getItemStatusCounts as jest.Mock).mockResolvedValue(counts.statusCounts);
});
test('overview focus commits verified totals from one RPC with no item/photo hydration',async()=>{
 const inventory=useInventory({}, {countsOnly:true});
 mockFocus[0]();await inventory.reload();
 expect(readCanonicalInventoryCounts).toHaveBeenCalledTimes(1);
 expect(listItems).not.toHaveBeenCalled();expect(getItemStatusCounts).not.toHaveBeenCalled();
 expect(mockState.canonical).toEqual(counts);expect(mockState.items).toEqual([]);
 expect(mockState.loading).toBe(false);expect(mockState.error).toBeNull();
});
test('closed item picker performs no backend work even on focus or reload',async()=>{
 const inventory=useInventory({}, {enabled:false});mockFocus[0]();await inventory.reload();
 expect(readCanonicalInventoryCounts).not.toHaveBeenCalled();expect(listItems).not.toHaveBeenCalled();
 expect(inventory.items).toEqual([]);expect(inventory.hasSnapshot).toBe(false);
});
test('explicitly opened picker hydrates stock and verifies the revision before commit',async()=>{
 const inventory=useInventory({}, {enabled:true});await inventory.reload();
 expect(listItems).toHaveBeenCalledWith('tenant',expect.objectContaining({specialistIds:['coins'],lifecycleGroup:'active'}));
 expect(readCanonicalInventoryCounts).toHaveBeenCalledTimes(2);
 expect(mockState.items).toEqual([{id:'coin'}]);expect(mockState.loading).toBe(false);
});
test('concurrent overview requests share the same in-flight operation',async()=>{
 const inventory=useInventory({}, {countsOnly:true});
 await Promise.all([inventory.reload(),inventory.reload(),inventory.reload()]);
 expect(readCanonicalInventoryCounts).toHaveBeenCalledTimes(1);
});
test('transient overview error retains only same-scope confirmed counts, not a false success',async()=>{
 mockSeed={scope:'user:tenant:coins:1:{}:counts',items:[],counts:counts.statusCounts,canonical:counts,error:null,loading:false};
 (readCanonicalInventoryCounts as jest.Mock).mockRejectedValue(new Error('[500] 57014: statement timeout'));
 const inventory=useInventory({}, {countsOnly:true});await inventory.reload();
 expect(mockState.canonical).toEqual(counts);expect(mockState.error).toContain('57014');expect(mockState.loading).toBe(false);
 expect(listItems).not.toHaveBeenCalled();
});
test('authorization denial clears a previously confirmed overview instead of granting stale access',async()=>{
 mockSeed={scope:'user:tenant:coins:1:{}:counts',items:[],counts:counts.statusCounts,canonical:counts,error:null,loading:false};
 (readCanonicalInventoryCounts as jest.Mock).mockRejectedValue(new Error('[403] Access denied'));
 const inventory=useInventory({}, {countsOnly:true});await inventory.reload();
 expect(mockState.canonical.total).toBe(0);expect(mockState.counts).toEqual({});expect(mockState.error).toContain('denied');
});
test('failed first read never hydrates photos or invents a successful empty inventory',async()=>{
 (readCanonicalInventoryCounts as jest.Mock).mockRejectedValue(new Error('Network request failed'));
 const inventory=useInventory({}, {countsOnly:true});await inventory.reload();
 expect(mockState.error).toBe('Network request failed');expect(mockState.canonical.revision).toBeUndefined();
 expect(listItems).not.toHaveBeenCalled();
});
