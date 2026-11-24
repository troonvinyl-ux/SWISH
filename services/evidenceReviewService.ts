// Seller review is a claim, not authentication or an increased model percentage.
import type { AIIdentificationResult } from './aiIdentificationService';
import { getSpecialistProfile, usefulText } from '@/shared/specialistIntelligence';
export interface EvidenceReviewQuestion {key:string;question:string;reason:string}
export interface SellerEvidenceReview {version:string;fingerprint:string;decision:'confirm'|'provisional';candidate:string;conflicts:Array<{issue:string;response:string}>;notes:string;recordedAt:string}
const version='seller-evidence-review-v1';
export function evidenceCandidates(result:AIIdentificationResult):string[]{return [...new Set([result.candidateIdentification?.primaryCandidate,result.canonicalTitle,...(result.candidateIdentification?.alternativeCandidates??[])].map(v=>usefulText(v,180)).filter(Boolean))].slice(0,10);}
export function evidenceReviewFingerprint(result:AIIdentificationResult):string {
 const fields=Object.entries(result.specialistAnalysis?.fields??{}).sort(([a],[b])=>a.localeCompare(b)).map(([key,row])=>[key,row.value,row.basis]);
 const q=result.specialistAnalysis?.quality;
 // Positional tuples are stable across PostgreSQL JSONB object-key reordering.
 const text=JSON.stringify([result.canonicalTitle,result.specialistId,result.confidence,result.identificationState,result.evidenceContradictory,result.missingInformation,fields,q?[q.status,q.issues,q.nextPhoto]:null]);let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);return `${version}:${text.length}:${(hash>>>0).toString(16)}`;
}
export function evidenceReviewQuestions(result:AIIdentificationResult):EvidenceReviewQuestion[]{return (result.specialistAnalysis?.followUps??[]).map(row=>({key:row.key,question:row.question,reason:row.reason}));}
export function needsEvidenceReview(result:AIIdentificationResult):boolean{return result.confidence<0.95||result.identificationState==='observation_only'||result.evidenceContradictory.length>0;}
export function evidenceReviewIssue(result:AIIdentificationResult):string|null {
 const review=result.attributes._seller_evidence_review as SellerEvidenceReview|undefined;
 if(!review||review.version!==version||review.fingerprint!==evidenceReviewFingerprint(result))return 'Review the candidate and answer the conflicting evidence below before listing.';
 if(!['confirm','provisional'].includes(review.decision)||!usefulText(review.candidate)||!usefulText(review.notes)||!Array.isArray(review.conflicts))return 'Choose an attribution and explain what you checked, or keep the identification provisional.';
 if(result.evidenceContradictory.some(issue=>!review.conflicts.some(row=>row?.issue===issue&&typeof row.response==='string'&&row.response.trim().length>=3)))return 'Explain each reported conflict; unresolved facts must stay disclosed in the description.';
 return null;
}
export function applySellerEvidenceReview(result:AIIdentificationResult,niche:string,answers:Record<string,string>,now=new Date().toISOString()):AIIdentificationResult {
 const decision=answers._review_decision,candidate=usefulText(answers._review_candidate,180)||result.canonicalTitle,notes=usefulText(answers._review_notes,1000);
 const conflicts=result.evidenceContradictory.map((issue,index)=>({issue,response:usefulText(answers[`_review_conflict_${index}`],500)}));
 const attributes={...result.attributes},confirmed={...result.attributesConfirmed},analysis=result.specialistAnalysis?{...result.specialistAnalysis,fields:{...result.specialistAnalysis.fields}}:undefined;
 for(const field of getSpecialistProfile(niche)?.fields??[]){const value=usefulText(answers[field.key]);if(!value)continue;attributes[field.key]=value;confirmed[field.key]=value;delete attributes[`_inferred_${field.key}`];if(analysis)analysis.fields[field.key]={value,basis:'user_supplied',reason:'Seller supplied during evidence review; not independent verification.'};}
 const next={...result,attributes,attributesConfirmed:confirmed,...(analysis?{specialistAnalysis:analysis}:{})};
 // A panel records its starting fingerprint; new observations invalidate old answers.
 if(answers._review_fingerprint!==evidenceReviewFingerprint(result))return next;
 if((decision==='confirm'||decision==='provisional')&&notes&&conflicts.every(row=>row.response.length>=3))attributes._seller_evidence_review={version,fingerprint:evidenceReviewFingerprint(next),decision,candidate,conflicts,notes,recordedAt:now} satisfies SellerEvidenceReview;
 return next;
}
export function sellerReviewDisclosure(result:AIIdentificationResult):string {
 const review=result.attributes._seller_evidence_review as SellerEvidenceReview|undefined;
 if(!review||evidenceReviewIssue(result))return '';
 return ['Seller identification review (not authentication):',review.decision==='provisional'?`Provisional attribution: ${review.candidate}. Exact type/variety is not verified.`:`Seller-selected attribution: ${review.candidate}.`,review.notes,...review.conflicts.map(row=>`${row.issue} — Seller response: ${row.response}`),review.decision==='provisional'&&result.missingInformation.length?`Not established: ${result.missingInformation.join('; ')}`:''].filter(Boolean).join('\n');
}
