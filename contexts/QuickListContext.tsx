import { createContext, useState, useCallback, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import type { CapturedImage, AIIdentificationResult } from '@/services/aiIdentificationService';
import type { QuickDraft } from '@/services/quickListService';
import type { ProductLead, QuickTiming } from '@/shared/quickList';
import type { StudioState } from '@/shared/listingStudio';
import { compactStudioHistory } from '@/services/listingStudioRetentionService';
export interface QuickListState {studio?:StudioState;scope:string;sessionId:string;images:CapturedImage[];leads:ProductLead[];lead:ProductLead|null;barcodeBusy:boolean;visual:boolean;processing:boolean;result:AIIdentificationResult|null;draft:QuickDraft|null;itemId:string;error:string;connectionError:string;unconfirmed:boolean;liveId:string;autoPublish:boolean;reviewed:boolean;savedForLater:boolean;timing:QuickTiming|null;measurements:Record<string,string>;categoryId:string;categoryName:string;title:string;description:string;price:string;conditionId:string;conditionNotes:string;specifics:Array<{name:string;value:string}>;showDetails:boolean;specialistId:string;mode:string;photoSlotId:string;phase:string;allowPhotoWarnings:boolean;studioWarning:string}
export function emptyQuickList():QuickListState{return {scope:'',sessionId:'',images:[],leads:[],lead:null,barcodeBusy:false,visual:false,processing:false,result:null,draft:null,itemId:'',error:'',connectionError:'',unconfirmed:false,liveId:'',autoPublish:false,reviewed:false,savedForLater:false,timing:null,measurements:{},categoryId:'',categoryName:'',title:'',description:'',price:'',conditionId:'',conditionNotes:'',specifics:[],showDetails:false,specialistId:'',mode:'item',photoSlotId:'',phase:'',allowPhotoWarnings:false,studioWarning:''};}
export const QuickListContext=createContext<{state:QuickListState;setState:Dispatch<SetStateAction<QuickListState>>}|undefined>(undefined);
export function QuickListProvider({children}:{children:ReactNode}){
 const [state,setStored]=useState<QuickListState>(emptyQuickList);
 const setState=useCallback<Dispatch<SetStateAction<QuickListState>>>(action=>setStored(previous=>{
  const next=typeof action==='function'?action(previous):action;
  return next.studio?{...next,studio:compactStudioHistory(next.studio)}:next;
 }),[]);
 return <QuickListContext.Provider value={{state,setState}}>{children}</QuickListContext.Provider>;
}
