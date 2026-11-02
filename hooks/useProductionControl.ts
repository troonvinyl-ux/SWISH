import { useCallback, useEffect, useMemo, useState } from 'react';
import { assessProductionPull, getNicheCertification, summarizeProductionWorkflowJobs, type ProductionStage, type ProductionTask } from '@/services/productionControlEvidence';
import { createProductionSnapshot, fetchProductionSnapshot, type ProductionSnapshot } from '@/services/productionControlService';
export function useProductionControl(enabled: boolean) {
  const [snapshot,setSnapshot]=useState<ProductionSnapshot>(()=>createProductionSnapshot());
  const [loading,setLoading]=useState(false);
  const [selectedNicheId,setSelectedNicheId]=useState('');
  const [expandedStageId,setExpandedStageId]=useState('');
  const refresh=useCallback(async(force=false)=>{
    if(!enabled)return;setLoading(true);
    try{const next=await fetchProductionSnapshot(force);setSnapshot(next);if(next.niches.length&&!next.niches.some(n=>n.id===selectedNicheId))setSelectedNicheId(next.niches[0].id);}
    finally{setLoading(false);}
  },[enabled,selectedNicheId]);
  useEffect(()=>{if(enabled)void refresh(false);},[enabled,refresh]);
  const overview=useMemo(()=>{
    const stages:ProductionStage[]=snapshot.register?.stages??[];
    const tasks:ProductionTask[]=stages.flatMap(stage=>stage.tasks);
    const verified=tasks.filter(task=>task.status==='VERIFIED').length;
    const blocked=tasks.filter(task=>task.status==='BLOCKED').length;
    const currentStage=stages.find(stage=>stage.status!=='VERIFIED'||stage.tasks.some(task=>task.status!=='VERIFIED'))??null;
    const certifications=snapshot.niches.map(niche=>({...niche,...getNicheCertification(snapshot.register,niche.id,snapshot.mainSha,snapshot.source==='LIVE')}));
    const gatesVerified=certifications.reduce((total,niche)=>total+niche.verified,0);
    const gatesTotal=certifications.reduce((total,niche)=>total+niche.total,0);
    const certified=certifications.filter(niche=>niche.certified).length;
    const pulls=snapshot.pulls.map(pull=>({...pull,assessment:assessProductionPull(pull)}));
    const workflows=snapshot.workflows.map(workflow=>({...workflow,summary:summarizeProductionWorkflowJobs(workflow.jobs),current:!!workflow.run&&snapshot.source==='LIVE'&&workflow.run.head_sha===snapshot.mainSha}));
    const risks=snapshot.register?.knownReleaseRisks??[];
    const readiness=tasks.length?Math.round(verified/tasks.length*100):0;
    const complete=snapshot.source==='LIVE'&&tasks.length>0&&verified===tasks.length&&certifications.length===snapshot.niches.length&&certifications.length>0&&certified===certifications.length&&risks.length===0&&snapshot.errors.length===0;
    const verdict=complete?'READY FOR FINAL RELEASE REVIEW':snapshot.source!=='LIVE'?'CURRENT EVIDENCE NOT VERIFIED':'PRODUCTION ACCEPTANCE INCOMPLETE';
    return{stages,tasks,verified,blocked,currentStage,certifications,gatesVerified,gatesTotal,certified,pulls,workflows,risks,readiness,complete,verdict};
  },[snapshot]);
  const selectedNiche=overview.certifications.find(niche=>niche.id===selectedNicheId)??overview.certifications[0]??null;
  return{snapshot,loading,refresh,overview,selectedNiche,setSelectedNicheId,expandedStageId,setExpandedStageId};
}
