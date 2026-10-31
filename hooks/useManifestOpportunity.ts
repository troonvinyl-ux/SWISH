import { useContext, useState, useMemo, useRef, useCallback, useEffect } from 'react';
import type { ManifestPhase } from '@/constants/manifestExperience';
import { friendlyManifestError, bestManifestProducts, presentLotVerdict, presentBaseLotVerdict } from '@/services/manifestExperienceService';
import { suggestLotBid } from '@/services/lotBiddingService';
import { ManifestOpportunityContext, emptyManifestSession } from '@/contexts/ManifestOpportunityContext';
import { useApp } from './useApp';
import { useWatchedLots } from './useWatchedLots';
import { restoreWatchedLotSession } from '@/services/watchedLotService';
import { resolveProductionNiche } from '@/services/nicheRouting';
import { evaluateManifestLot, toLotLines, type LotLine, type LotAssumptions } from '@/services/lotEconomicsService';
import { normaliseManifest, parseManifestText, type ParsedManifest } from '@/services/manifestParser';
import { compileManifestDrafts, manifestIdentity, savePurchasedManifest } from '@/services/manifestListingService';
import { invokeListingOperation } from '@/services/listingEditorService';
import { simpleLotAdvice } from '@/services/lotSimpleAdviceService';
import { normaliseAuctionUrl } from '@/services/auctionLinkService';
import { useManifestSoldComparisons } from './useManifestSoldComparisons';

export function useManifestOpportunity() {
  const context = useContext(ManifestOpportunityContext);
  if (!context) throw new Error('Manifest opportunity provider is required.');
  const { scope,draft,setDraft } = context;
  const watched = useWatchedLots();
  const { tenant,activeNicheId,fixedNicheId,triggerInventoryReload } = useApp();
  const nicheId = resolveProductionNiche(fixedNicheId ?? activeNicheId);
  const sold = useManifestSoldComparisons(scope,draft.key,tenant?.id ?? null,nicheId);
  const currentScope = useRef(scope);
  const scopeEpoch = useRef(0);
  if (currentScope.current !== scope) { currentScope.current=scope;scopeEpoch.current++; }
  const lock = useRef(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const [phase,setPhase] = useState<ManifestPhase>('checking');
  const [step,setStep] = useState<1 | 2 | 3>(draft.restoredWatchAt ? 3 : draft.lines.length ? 2 : 1);
  const [notice,setNotice] = useState('');
  const [suggestions,setSuggestions] = useState<{scope:string;rowId:string;rows:any[]} | null>(null);
  const locked = busy || watched.busy;
  useEffect(()=>{setStep(draft.restoredWatchAt ? 3 : draft.lines.length ? 2 : 1);setError(null);setNotice('');},[scope]);

  const run = useCallback(async (operation: (stillCurrent: () => boolean) => Promise<void>, initialPhase: ManifestPhase = 'checking') => {
    if (lock.current || watched.busy) return;
    lock.current=true;setPhase(initialPhase);setBusy(true);setError(null);setNotice('');
    const epoch=scopeEpoch.current;
    const stillCurrent=()=>currentScope.current===scope && scopeEpoch.current===epoch;
    try { await operation(stillCurrent); }
    catch (failure: unknown) { if(stillCurrent())setError(failure instanceof Error ? failure.message : 'Operation could not be completed.'); }
    finally {lock.current=false;setBusy(false);}
  },[scope,watched.busy]);
  const load = async (manifest: ParsedManifest,name:string,stillCurrent:()=>boolean) => {
    if(!nicheId)throw new Error('Select a production niche before importing a manifest.');
    if(!stillCurrent())return;
    setPhase('planning');
    const lines=toLotLines(manifest.rows);const key=await manifestIdentity(lines,nicheId);
    if(!stillCurrent())return;
    setDraft({...emptyManifestSession(),name,key,lines,warnings:manifest.warnings});setSuggestions(null);setStep(2);
    watched.clearError();
  };
  const pick=()=>run(async stillCurrent=>{
    const {pickManifest}=await import('@/services/manifestFileService');
    const picked=await pickManifest(value=>{if(stillCurrent())setPhase(value);});
    if(picked)await load(picked.manifest,picked.name,stillCurrent);
  },'choosing');
  const paste=(text:string)=>run(async stillCurrent=>{await load(normaliseManifest(parseManifestText(text)),'Pasted manifest',stillCurrent);});
  const example=()=>run(async stillCurrent=>{
    const {suppliedManifestExample}=await import('@/constants/manifestExample');
    await load(suppliedManifestExample(),'Supplied example · spW91E1008R',stillCurrent);
  });
  const updateLine=(id:string,patch:Partial<LotLine>)=>{
    if(draft.acquisitionId||locked)return;
    setDraft(previous=>({...previous,lines:previous.lines.map(line=>line.id===id?{...line,...patch}:line)}));
  };
  const updateAssumption=(key:keyof LotAssumptions,value:number|null)=>{
    if(locked)return;
    setDraft(previous=>({...previous,assumptions:{...previous.assumptions,[key]:value} as LotAssumptions,
      watchedBidNeedsRefresh:key==='currentBid'||key==='minutesLeft'?false:previous.watchedBidNeedsRefresh}));
  };
  const evaluation=useMemo(()=>evaluateManifestLot(draft.lines,draft.assumptions),[draft.lines,draft.assumptions]);
  const paidAnalysis=useMemo(()=>evaluateManifestLot(draft.lines,{...draft.assumptions,currentBid:draft.paidHammer.trim()?Number(draft.paidHammer):null}),[draft.lines,draft.assumptions,draft.paidHammer]);
  const plans=useMemo(()=>compileManifestDrafts(draft.lines,draft.assumptions,draft.strategy),[draft.lines,draft.assumptions,draft.strategy]);
  const saveWatch=()=>run(async stillCurrent=>{
    const row=await watched.saveWatch(draft);
    if(row&&stillCurrent())setNotice('Saved to your watched lots. Your list and base maximum will be here when you return. Nothing has been purchased or added to stock.');
  },'watching');
  const openWatch=async(id:string)=>{
    if(lock.current||watched.busy)return false;
    const epoch=scopeEpoch.current;
    const snapshot=await watched.openWatch(id);
    if(!snapshot||currentScope.current!==scope||scopeEpoch.current!==epoch)return false;
    // Restoration flags live in the shared session, not this page's local state.
    // A newly mounted workspace must not suggest bids using stale auction details.
    setDraft(restoreWatchedLotSession(snapshot));setSuggestions(null);setError(null);setNotice('');setStep(3);
    return true;
  };
  const findCategories=(rowId:string)=>run(async stillCurrent=>{
    setPhase('categories');
    const row=draft.lines.find(r=>r.id===rowId);
    if(!row||!tenant)throw new Error('Sign in and wait for your business to load.');
    const result=await invokeListingOperation({tenantId:tenant.id,route:'get_category_suggestions',query:row.title.slice(0,100)},'swish-ebay-category');
    if(result.error||!result.data?.success)throw new Error(result.error??'eBay category lookup unavailable.');
    if(stillCurrent())setSuggestions({scope,rowId,rows:result.data.suggestions??[]});
  });
  const chooseCategory=(rowId:string,category:any)=>run(async stillCurrent=>{
    setPhase('categories');
    if(!tenant||!category.isLeaf)throw new Error('Choose a leaf category.');
    const result=await invokeListingOperation({tenantId:tenant.id,route:'get_category_aspects',categoryId:category.id});
    if(result.error||!result.data?.success||result.data.isLeaf!==true)throw new Error(result.error??'Category requirements not verified.');
    const names:string[]=(result.data.aspects??[]).filter((entry:any)=>entry.aspectConstraint?.aspectRequired===true||entry.aspectConstraint?.aspectUsage==='REQUIRED')
      .map((entry:any)=>String(entry.aspectName??entry.localizedAspectName??'')).filter(Boolean);
    if(!stillCurrent())return;
    setDraft(previous=>({...previous,lines:previous.lines.map(row=>row.id===rowId?{...row,categoryId:String(category.id),categoryName:String(category.name),taxonomyChecked:true,
      requiredSpecifics:names,specifics:[...new Set(['Brand',...names])].map(name=>({name,value:row.specifics?.find(s=>s.name===name)?.value??(name==='Brand'?row.brand:'')}))}:row)}));
    setSuggestions(null);
  });
  const save=()=>run(async stillCurrent=>{
    setPhase('saving');
    if(!tenant||!nicheId)throw new Error('A signed-in business and production niche are required.');
    if(!draft.paidHammer.trim())throw new Error('Enter the actual paid hammer price after winning/buying. Current bids are not purchases.');
    if(evaluation.errors.length)throw new Error(evaluation.errors[0]);
    const response=await savePurchasedManifest({tenantId:tenant.id,nicheId,name:draft.name,key:draft.key,
      paidHammer:Number(draft.paidHammer),assumptions:draft.assumptions,units:plans,analysis:paidAnalysis});
    if(!stillCurrent())return;
    setDraft(previous=>({...previous,acquisitionId:response.acquisitionId,itemIds:response.itemIds,listingIds:response.listingIds}));
    triggerInventoryReload();setNotice(response.existing?'You already saved this lot. Your original stock and listings are ready to open.':`Your lot is saved. ${response.listingIds.length} listings are waiting for your review. Nothing is live on eBay yet.`);
  });
  const rankedProducts=useMemo(()=>bestManifestProducts(draft.lines),[draft.lines]);
  const verdict=useMemo(()=>presentLotVerdict(evaluation),[evaluation]);
  const baseVerdict=useMemo(()=>presentBaseLotVerdict(evaluation.base),[evaluation.base]);
  const biddingAdvice=useMemo(()=>suggestLotBid({ceiling:evaluation.base.maximumHammerBid,currentBid:draft.assumptions.currentBid,
    increment:draft.assumptions.increment,bidCount:draft.assumptions.bidCount,minutesLeft:draft.assumptions.minutesLeft,
    blocked:draft.watchedBidNeedsRefresh||evaluation.base.status==='invalid'||evaluation.errors.length>0,
  }),[evaluation,draft.assumptions,draft.watchedBidNeedsRefresh]);
  const simpleAdvice=useMemo(()=>simpleLotAdvice(evaluation.base,biddingAdvice,draft.watchedBidNeedsRefresh),[evaluation.base,biddingAdvice,draft.watchedBidNeedsRefresh]);
  const setAuctionUrl=(value:string)=>{if(!locked)setDraft(previous=>({...previous,auctionUrl:value}));};
  const auctionLinkError=useMemo(()=>{try {normaliseAuctionUrl(draft.auctionUrl);return null;}catch(failure){return failure instanceof Error?failure.message:'Check the auction link.';}},[draft.auctionUrl]);
  const revealResult=()=>{
    if(lock.current||watched.busy||!draft.lines.length)return;
    if(evaluation.errors.length){setError(evaluation.errors[0]);return;}
    setError(null);setStep(3);
  };
  const restoredNotice=draft.restoredWatchAt&&draft.watchedBidNeedsRefresh
    ? 'Watched plan reopened. The bid and time are saved details, not a live auction. Update them before using a bidding suggestion. Nothing has been added to stock.' : '';
  return {draft,busy:locked,error:error?friendlyManifestError(error):watched.error,notice:notice||restoredNotice,nicheId,evaluation,verdict,baseVerdict,biddingAdvice,rankedProducts,
    simpleAdvice,setAuctionUrl,auctionLinkError,soldRows:sold.soldRows,checkSold:sold.checkSold,
    watchedCount:watched.rows.length,watchedHasMore:watched.hasMore,watchReady:watched.ready,
    isWatched:watched.rows.some(row=>row.manifest_key===draft.key),saveWatch,openWatch,watchedBidNeedsRefresh:draft.watchedBidNeedsRefresh,
    phase:watched.busy&&!busy?'watching' as ManifestPhase:phase,step,setStep,revealResult,plans,pick,paste,example,updateLine,updateAssumption,
    findCategories,chooseCategory,suggestions:suggestions?.scope===scope?suggestions:null,save,
    reset:()=>{if(lock.current||watched.busy)return;setDraft(emptyManifestSession());setError(null);setNotice('');setSuggestions(null);setStep(1);watched.clearError();},
    setPaidHammer:(value:string)=>{if(!locked)setDraft(previous=>({...previous,paidHammer:value}));},
    setStrategy:(strategy:'individual'|'grouped'|'whole')=>{if(!locked)setDraft(previous=>({...previous,strategy}));},
  };
}
