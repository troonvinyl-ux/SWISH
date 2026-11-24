import type { StudioState, StudioEvidence } from '@/shared/listingStudio';
// Keep current per-photo evidence intact. Bound historical summaries so the
// existing item JSON remains a small metadata record, not an AI transcript store.
export function compactStudioHistory(studio:StudioState):StudioState{
 const summarize=(e:StudioEvidence):StudioEvidence=>({...e,candidate:e.candidate.slice(0,180),guidance:e.guidance.slice(0,180),answer:e.answer.slice(0,240),missing:e.missing.slice(0,4).map(t=>t.slice(0,120)),conflicts:e.conflicts.slice(0,4).map(t=>t.slice(0,120)),photos:e.photos.slice(0,12).map(p=>({...p,observations:p.observations.slice(0,1).map(t=>t.slice(0,80)),condition:p.condition.slice(0,1).map(t=>t.slice(0,80)),limitations:p.limitations.slice(0,1).map(t=>t.slice(0,80))}))});
 return {...studio,notes:studio.notes.slice(0,2000),question:studio.question.slice(0,500),history:studio.history.slice(-6).map(summarize)};
}
