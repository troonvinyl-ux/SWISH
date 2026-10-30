import { useState,useMemo,useCallback,useRef,useEffect } from 'react';
import { getMarketValue,type MarketValueResult } from '@/services/marketValueService';
import { calculateFlipIntelligence,type FlipInputs } from '@/services/flipIntelligenceService';
import type { AIIdentificationResult } from '@/services/aiIdentificationService';
const defaults={ purchaseCost:'',shippingCost:'',shippingRevenue:'',packagingCost:'',repairCost:'',otherCosts:'',feeRate:'13',fixedFee:'0.40',labourHours:'',labourRate:'15',minProfit:'10',minROI:'30',budget:'500',maxHoldingDays:'90',resalePrice:'',conservativePrice:'',holdingDays:'',sellableYield:'100' };
export type FlipField=keyof typeof defaults;
export function useFlipIntelligence(result:AIIdentificationResult|null,tenantId:string|undefined,nicheId:string) {
  const [values,setValues]=useState(defaults); const [market,setMarket]=useState<MarketValueResult|null>(null);
  const [loading,setLoading]=useState(false); const [error,setError]=useState<string|null>(null);
  const scope=tenantId+':'+nicheId+':'+(result?.canonicalTitle ?? '')+':'+(result?.confidence ?? 0);
  const current=useRef(scope);current.current=scope;
  useEffect(()=>{ setMarket(null);setError(null);setLoading(false); },[scope]);
  const update=useCallback((key:FlipField,value:string)=>setValues(previous=>({ ...previous,[key]:value })),[]);
  const research=useCallback(async()=>{
    if(!result || !tenantId || loading) return;
    setLoading(true);setError(null);
    const requestScope=scope;
    try {
      const response=await getMarketValue({ tenantId,title:result.canonicalTitle,specialistId:result.specialistId,attributes:result.attributes,condition:result.condition,identificationConfidence:result.confidence,applyToItem:false });
      if(current.current!==requestScope) return;
      if(response.error || !response.result) { setError(response.error ?? 'Market research returned no evidence.');return; }
      setMarket(response.result);
    } catch(e:any) { if(current.current===requestScope) setError(e?.message ?? 'Market research failed.'); } finally { if(current.current===requestScope) setLoading(false); }
  },[result,tenantId,loading,scope]);
  const calculation=useMemo(()=>{
    if(!result) return { data:null,error:null };
    try {
      const parsed=Object.fromEntries(Object.entries(values).map(([key,value])=>[key,value.trim() ? Number(value) : 0])) as Record<FlipField,number>;
      const input:FlipInputs={ ...parsed,nicheId,market,analysis:result.specialistAnalysis,attributes:result.attributes,identificationConfidence:result.confidence,feeRate:parsed.feeRate/100,minROI:parsed.minROI/100,sellableYield:parsed.sellableYield/100,
        resalePrice:values.resalePrice.trim() ? parsed.resalePrice : undefined,conservativePrice:values.conservativePrice.trim() ? parsed.conservativePrice : undefined,holdingDays:values.holdingDays.trim() ? parsed.holdingDays : undefined };
      return { data:calculateFlipIntelligence(input),error:null };
    } catch(e:any) { return { data:null,error:e?.message ?? 'Invalid cost assumptions.' }; }
  },[result,market,values,nicheId]);
  return { values,update,research,market,loading,error:error ?? calculation.error,calculation:calculation.data };
}
