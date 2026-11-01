import { useState, useRef, useEffect, useCallback } from 'react';
import { useApp } from './useApp';
import { useAuth, useAlert } from '@/template';
import { captureFromCamera, pickFromLibrary, identifyItemWithAI, saveIdentifiedItem, uploadItemImages, updateItemMedia, type CapturedImage, type AIIdentificationResult } from '@/services/aiIdentificationService';
import { SPECIALISTS, type SpecialistId } from '@/constants/specialists';
import { getSpecialistProfile } from '@/shared/specialistIntelligence';
import { readCaptureDraft, persistCaptureDraft, retainCaptureImage, type CaptureDraft } from '@/services/captureDraftService';
import { inspectPhotoQuality } from '@/services/photoQualityService';
const emptyDraft = (specialistId: string): CaptureDraft => ({ images:[],result:null,savedId:null,mode:'item',specialistId,answers:{} });
export function useGenericCapture() {
  const { tenant, activeNiche, triggerInventoryReload } = useApp(); const { user } = useAuth(); const { showAlert } = useAlert();
  const scope = `${user?.id ?? ''}:${tenant?.id ?? ''}:${activeNiche.id}`;
  const current = useRef(scope); current.current=scope; const lock=useRef(false);
  const [draft,setDraft]=useState<CaptureDraft>(emptyDraft(activeNiche.defaultSpecialist));
  const [loadedScope,setLoadedScope]=useState(''); const [busy,setBusy]=useState(false);
  const [phase,setPhase]=useState(''); const [error,setError]=useState<string|null>(null);
  const [allowPhotoWarnings,setAllowPhotoWarnings]=useState(false);
  const profile=getSpecialistProfile(activeNiche.id); const ready=loadedScope===scope;
  const visible=ready ? draft : emptyDraft(activeNiche.defaultSpecialist);
  const specialistId=visible.specialistId as SpecialistId;
  const slots=visible.mode==='part' ? [
    { id:'main',label:'Complete component',description:'Show shape, mounting points and included hardware',required:true },
    { id:'part_number',label:'Part number / label',description:'Read the full stamped or printed model number',required:true },
    { id:'mounts',label:'Mounts and connections',description:'Show mounting points, connectors and a ruler where useful',required:false },
    { id:'condition',label:'Wear / damage',description:'Document damage, corrosion, seals and missing parts',required:false },
  ] : SPECIALISTS[specialistId]?.captureRequirements ?? [];
  useEffect(()=>{
    let cancelled=false; setError(null); setPhase(''); setBusy(false); setLoadedScope(''); setAllowPhotoWarnings(false);
    void readCaptureDraft(scope).then(saved=>{
      if (cancelled) return;
      const valid = saved && activeNiche.specialists.includes(saved.specialistId as SpecialistId) && Array.isArray(saved.images);
      setDraft(valid ? saved : emptyDraft(activeNiche.defaultSpecialist)); setLoadedScope(scope);
    });
    return ()=>{ cancelled=true; };
  },[scope,activeNiche.defaultSpecialist]);
  useEffect(()=>{
    if (!ready || !user || !tenant) return;
    const timer=setTimeout(()=>{ void persistCaptureDraft(scope,draft).catch(()=>{ if(current.current===scope) setError('Draft could not be retained on this device. Keep the screen open and retry.'); }); },250);
    return ()=>clearTimeout(timer);
  },[draft,ready,scope,user?.id,tenant?.id]);
  const changeMode=useCallback((mode: string)=>{
    if (busy || !profile?.modes.some(m=>m.id===mode)) return;
    setDraft(previous=>({ ...emptyDraft(previous.specialistId),mode })); setError(null);
  },[busy,profile]);
  const changeSpecialist=useCallback((id: SpecialistId)=>{
    if (busy || !activeNiche.specialists.includes(id)) return;
    setDraft(emptyDraft(id)); setError(null);
  },[busy,activeNiche]);
  const capture=useCallback(async (slotId:string,library:boolean)=>{
    const slot=slots.find(s=>s.id===slotId); if(!slot || lock.current || !ready || visible.savedId) return;
    lock.current=true; setBusy(true); setError(null);
    try {
      const selected=library ? await pickFromLibrary(slot.id,slot.label) : await captureFromCamera();
      if(!selected || current.current!==scope) return;
      setAllowPhotoWarnings(false);
      if(selected.width && selected.height && Math.min(selected.width,selected.height)<320) { setError('This photo has too little detail. Retake closer or choose a higher-resolution image.'); return; }
      const photoQuality=selected.photoQuality ?? await inspectPhotoQuality(selected.uri);
      const image=await retainCaptureImage({ ...selected,photoQuality,slotId,slotLabel:slot.label });
      if(current.current===scope) setDraft(previous=>({ ...previous,images:[...previous.images.filter(i=>i.slotId!==slotId),image],result:null }));
    } catch(e:any) { if(current.current===scope) setError(e?.message ?? 'Photo capture failed.'); }
    finally { lock.current=false; if(current.current===scope) { setBusy(false); setPhase(''); } }
  },[scope,slots,ready,visible.savedId]);
  const addCapturedPhoto=useCallback(async (slotId:string, selected:{uri:string;width?:number;height?:number})=>{
    const slot=slots.find(item=>item.id===slotId);
    if(!slot || !selected.uri || !ready || visible.savedId || lock.current) return;
    lock.current=true;
    try {
      if(selected.width && selected.height && Math.min(selected.width,selected.height)<320) throw new Error('This photo has too little detail. Move closer and try again.');
      const photoQuality=await inspectPhotoQuality(selected.uri);
      const image=await retainCaptureImage({ ...selected,photoQuality,slotId,slotLabel:slot.label });
      if(current.current===scope) { setAllowPhotoWarnings(false); setDraft(previous=>({ ...previous,images:[...previous.images.filter(item=>item.slotId!==slotId),image],result:null })); }
    } catch(e:any) { if(current.current===scope) setError(e?.message ?? 'Could not keep this photograph.'); }
    finally { lock.current=false; }
  },[slots,ready,visible.savedId,scope]);
  const removeCapturedPhoto=useCallback((slotId:string)=>{
    if(busy || visible.savedId) return;
    setDraft(previous=>({ ...previous,images:previous.images.filter(image=>image.slotId!==slotId),result:null }));
  },[busy,visible.savedId]);
  const identify=useCallback(async ()=>{
    if(!tenant || lock.current || !ready || !visible.images.length || visible.savedId) return;
    lock.current=true; setBusy(true); setPhase('Analysing specialist evidence'); setError(null);
    try {
      const notes=Object.entries(visible.answers).filter(([,value])=>value.trim()).map(([key,value])=>`${key}: ${value} (user-supplied; cross-check)`).join('\n');
      const response=await identifyItemWithAI(visible.images,specialistId,undefined,{ customNotes:notes,existingAttributes:visible.result?.attributes },{ tenantId:tenant.id,captureMode:visible.mode,allowPhotoWarnings });
      if(current.current!==scope) return;
      if(response.error || !response.result) { setError(response.error ?? 'No identification was returned.'); return; }
      setDraft(previous=>({ ...previous,result:response.result }));
    } catch(e:any) { if(current.current===scope) setError(e?.message ?? 'Identification failed.'); }
    finally { lock.current=false; if(current.current===scope) { setBusy(false); setPhase(''); } }
  },[tenant?.id,ready,scope,visible,specialistId,allowPhotoWarnings]);
  const answer=useCallback((key:string,value:string)=>setDraft(previous=>({ ...previous,answers:{ ...previous.answers,[key]:value } })),[]);
  const correctTitle=useCallback((title:string)=>setDraft(previous=>({ ...previous,result:previous.result ? { ...previous.result,canonicalTitle:title } : null })),[]);
  const reviewedResult=useCallback(()=>{
    if(!visible.result) return null;
    const result={ ...visible.result,attributes:{ ...visible.result.attributes } };
    if(result.specialistAnalysis) result.specialistAnalysis={ ...result.specialistAnalysis,fields:{ ...result.specialistAnalysis.fields } };
    for(const [key,value] of Object.entries(visible.answers)) {
      if(!value.trim() || !profile?.fields.some(field=>field.key===key)) continue;
      result.attributes[key]=value.trim();
      if(result.specialistAnalysis) result.specialistAnalysis.fields[key]={ value:value.trim(),basis:'user_supplied',reason:'Entered during human review; not independently verified.' };
    }
    return result;
  },[visible,profile]);
  const save=useCallback(async ()=>{
    const result=reviewedResult();
    if(!tenant || !result || lock.current || !result.canonicalTitle.trim()) return;
    lock.current=true; setBusy(true); setPhase(visible.savedId ? 'Retrying photo upload' : 'Saving reviewed inventory'); setError(null);
    let id=visible.savedId;
    try {
      if(!id) {
        const response=await saveIdentifiedItem(tenant.id,result,{ mediaUris:[] });
        if(response.error || !response.item) throw new Error(response.error ?? 'Inventory save not confirmed.');
        id=response.item.id;
        // Record the canonical ID before uploading, so an upload retry NEVER creates another item.
        const savedDraft={ ...visible,result,savedId:id };
        if(current.current===scope) setDraft(savedDraft);
        await persistCaptureDraft(scope,savedDraft);
        triggerInventoryReload();
      }
      const upload=await uploadItemImages(id,visible.images);
      if(upload.urls.length) await updateItemMedia(tenant.id,id,upload.urls);
      if(upload.errors.length) throw new Error('Inventory is saved; some photos failed. Retry photos here without creating another item.');
      if(current.current===scope) triggerInventoryReload();
    } catch(e:any) { if(current.current===scope) setError(e?.message ?? 'Save failed.'); }
    finally { lock.current=false; if(current.current===scope) { setBusy(false); setPhase(''); } }
  },[tenant?.id,visible,scope,reviewedResult,triggerInventoryReload]);
  const reset=useCallback(()=>{ if(busy) return; const clear=()=>{ setDraft(emptyDraft(activeNiche.defaultSpecialist));setError(null);setAllowPhotoWarnings(false); }; if(visible.savedId) clear(); else showAlert('Discard capture draft?', 'Unsaved identification and selected photos will be removed from this draft. No inventory records are deleted.', [{ text:'Keep draft',style:'cancel' },{ text:'Discard draft',style:'destructive',onPress:clear }]); },[busy,activeNiche.defaultSpecialist,visible.savedId,showAlert]);
  return { allowPhotoWarnings,setAllowPhotoWarnings,activeNiche,profile,slots,images:visible.images,addCapturedPhoto,removeCapturedPhoto,result:visible.result,busy:busy || !ready,savedId:visible.savedId,error,phase,answers:visible.answers,mode:visible.mode,specialistId,capture,identify,save,reset,answer,correctTitle,changeMode,changeSpecialist };
}
