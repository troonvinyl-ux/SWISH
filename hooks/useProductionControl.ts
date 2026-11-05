import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { assessProductionPull, getNicheCertification, summarizeProductionWorkflowJobs } from '@/services/productionControlEvidence';
import { createProductionSnapshot, fetchProductionSnapshot, type ProductionSnapshot } from '@/services/productionControlService';
import { assessReadiness } from '@/services/readinessAssessmentService';
export function useProductionControl(enabled: boolean) {
 const [snapshot,setSnapshot]=useState<ProductionSnapshot>(()=>createProductionSnapshot());
 const [loading,setLoading]=useState(false); const request=useRef(0); const enabledRef=useRef(enabled); enabledRef.current=enabled;
 const [selectedNicheId,setSelectedNicheId]=useState(''); const [expandedStageId,setExpandedStageId]=useState('');
 const refresh=useCallback(async(force=false)=>{
  if(!enabled)return; const version=++request.current;setLoading(true);
  try { const next=await fetchProductionSnapshot(force); if(!enabledRef.current||version!==request.current)return; setSnapshot(next);setSelectedNicheId(previous=>next.niches.some(niche=>niche.id===previous)?previous:next.niches[0]?.id??''); }
  finally { if(version===request.current)setLoading(false); }
 },[enabled]);
 useEffect(()=>{if(enabled)void refresh(false);return()=>{request.current++;};},[enabled,refresh]);
 const overview=useMemo(()=>{
  const assessment=assessReadiness(snapshot);
  const stages=assessment.stages.map(stage=>({...stage,status:stage.verified===stage.total&&stage.total>0?'VERIFIED':stage.tasks.some(task=>task.status==='FAILED')?'FAILED':stage.tasks.some(task=>task.status==='BLOCKED')?'BLOCKED':'AWAITING VERIFICATION'}));
  const tasks=assessment.tasks;
  const currentStage=stages.find(stage=>stage.verified<stage.total)??null;
  const certifications=snapshot.niches.map(niche=>({...niche,...getNicheCertification(snapshot.register,niche.id,snapshot.mainSha,snapshot.source==='LIVE')}));
  const gatesVerified=certifications.reduce((total,niche)=>total+niche.verified,0);const gatesTotal=certifications.reduce((total,niche)=>total+niche.total,0);
  const certified=certifications.filter(niche=>niche.certified).length;
  const pulls=snapshot.pulls.map(pull=>({...pull,assessment:assessProductionPull(pull)}));
  const workflows=snapshot.workflows.map(workflow=>({...workflow,summary:summarizeProductionWorkflowJobs(workflow.jobs),current:!!workflow.run&&snapshot.source==='LIVE'&&workflow.run.head_sha===snapshot.mainSha}));
  const risks=snapshot.register?.knownReleaseRisks??[];
  const complete=assessment.verdict==='READY'||assessment.verdict==='READY WITH NON-CRITICAL WARNINGS';
  return {stages,tasks,verified:assessment.verified,blocked:assessment.blocked,currentStage,certifications,gatesVerified,gatesTotal,certified,pulls,workflows,risks,readiness:assessment.percentage,complete,verdict:assessment.verdict,assessment};
 },[snapshot]);
 const selectedNiche=overview.certifications.find(niche=>niche.id===selectedNicheId)??overview.certifications[0]??null;
 return {snapshot,loading,refresh,overview,selectedNiche,setSelectedNicheId,expandedStageId,setExpandedStageId};
}
