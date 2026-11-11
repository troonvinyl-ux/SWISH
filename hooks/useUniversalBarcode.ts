import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { useAuth } from '@/template';
import { useApp } from './useApp';
import { useBarcodeConfirmation } from './useBarcodeConfirmation';
import { lookupProductBarcode, type BarcodeLookupResult } from '@/services/barcodeLookupService';
import { normalizeProductBarcode, sameGtin, type ProductLead } from '@/shared/quickList';
import { nicheBarcodeAllowed } from '@/shared/nichePolicy';
import type { BarcodeProvider } from '@/shared/barcodeIdentification';
export function useUniversalBarcode() {
  const app = useApp(), { user } = useAuth(); const scope = `${user?.id}:${app.tenant?.id}:${app.activeNicheId}:${app.moduleEpoch}`;
  const current = useRef(scope); current.current = scope; const mounted = useRef(true), serial = useRef(0), activeFlight = useRef('');
  const [code,setCode] = useState(''), [type,setType] = useState(''), [result,setResult] = useState<BarcodeLookupResult|null>(null), [busy,setBusy] = useState(false), [error,setError] = useState(''), [provider,setProvider] = useState<BarcodeProvider>('gemini'), [index,setIndex] = useState(0), [sessionId,setSessionId] = useState('');
  const previousCode = useRef('');
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;serial.current++;};},[]);
  const reset=useCallback(()=>{serial.current++;activeFlight.current='';previousCode.current='';setCode('');setType('');setResult(null);setError('');setBusy(false);setIndex(0);setSessionId('');},[]);
  useEffect(()=>{reset();},[scope,reset]);
  const lookup=useCallback(async(value=code,format=type,chosen=provider)=>{
    if(!app.tenant?.id||!app.accessReady||app.moduleLoading||!nicheBarcodeAllowed(app.activeNicheId))return;
    const flight=`${scope}:${normalizeProductBarcode(value,format)??value}:${chosen}`;
    if(activeFlight.current===flight)return;activeFlight.current=flight;
    const version=++serial.current;setBusy(true);setError('');
    try{const response=await lookupProductBarcode(app.tenant.id,value,format,chosen);if(mounted.current&&current.current===scope&&serial.current===version){setResult(response);setIndex(0);setError(response.error??'');}}
    catch{if(mounted.current&&current.current===scope&&serial.current===version)setError('Barcode lookup unavailable. Retry this scan; saved items are unchanged.');}
    finally{if(activeFlight.current===flight)activeFlight.current='';if(mounted.current&&current.current===scope&&serial.current===version)setBusy(false);}
  },[scope,app.tenant?.id,app.accessReady,app.moduleLoading,app.activeNicheId,code,type,provider]);
  const read=useCallback((value:string,format:string)=>{
    const normalized=normalizeProductBarcode(value,format)??value;
    if(!sameGtin(previousCode.current,normalized)){setSessionId(`barcode-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`);setResult(null);setIndex(0);}
    previousCode.current=normalized;setCode(normalized);setType(format);setError('');void lookup(value,format);
  },[lookup]);
  const lead=result?.products[index]??null;
  const confirmation=useBarcodeConfirmation(lead,sessionId);
  const tryAnother=useCallback(()=>{
    if(result&&index+1<result.products.length){setIndex(index+1);return;}
    const other:BarcodeProvider=provider==='gemini'?'openai':'gemini';setProvider(other);setResult(null);setIndex(0);void lookup(code,type,other);
  },[result,index,provider,lookup,code,type]);
  const chooseProvider=useCallback((value:BarcodeProvider)=>{if(busy||confirmation.busy)return;setProvider(value);if(code){setResult(null);void lookup(code,type,value);}},[busy,confirmation.busy,code,type,lookup]);
  const openSource=useCallback(async()=>{const url=lead?.sourceUrls?.[0]??lead?.url;if(!url?.startsWith('https://'))return;try{await Linking.openURL(url);}catch{setError('Source link could not open.');}},[lead]);
  const manual=useCallback(()=>{
    if(!normalizeProductBarcode(code,type))return;
    setResult({gtin:normalizeProductBarcode(code,type)!,products:[{id:`manual:${code}`,title:'',gtin:normalizeProductBarcode(code,type)!,brand:'',model:'',categoryId:'',categoryName:'',specifics:{},source:'OnSpace AI',verificationStatus:'ai_suggested',confidence:0,url:'',summary:'Manual entry; no AI identification was available.'}],status:'candidates',message:'Replace the title and details before confirming.',error:null});setError('');setIndex(0);
  },[code,type]);
  return {ready:app.accessReady&&!app.moduleLoading&&Boolean(app.tenant?.id)&&nicheBarcodeAllowed(app.activeNicheId),scope,code,result,lead,busy,error,lookup,read,reset,provider,chooseProvider,tryAnother,openSource,confirmation,manual,accent:app.activeNiche.color};
}
