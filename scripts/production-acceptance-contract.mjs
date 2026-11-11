// Pure release-evidence processing. No provider calls, writes, credentials or deployment.
export const journeySteps = ['open','capture','upload','identify','catalogue','value','generate_listing','save_inventory','photos_retained','ebay_draft','publish_live','listing_id','reopen_once','report_counts'];
export const globalChecks = ['typescript','lint','unit','integration','edge_tests','production_build','android_build','web_build','test_integrity','tenant_isolation','niche_isolation','app_web_consistency','minority_report','collectibles_barcode','collectibles_photos','ancient_coin','numista','image_retries','publication_retries','duplicate_imports','draft_to_live','live_to_sold','quality_ambiguity','quality_claims','quality_completeness','quality_specifics','quality_photos','inventory_reconciliation','image_persistence','backend_deployment','hosted_web_deployment'];
const sha = /^[a-f0-9]{40}$/i;
const hash = /^[a-f0-9]{64}$/i;
export function requiredChecks(nicheIds) { return [...globalChecks, ...nicheIds.flatMap(id => journeySteps.map(step => `${id}:${step}`))]; }
export function blankAcceptance(sourceSha, nicheIds) {
 return {schemaVersion:1,sourceSha,checkedAt:new Date().toISOString(),review:{authorized:false,sourceSha:null},checks:requiredChecks(nicheIds).map(id=>({id,result:'NOT_TESTED',observed:false,kind:'runtime',assertions:0,sourceSha,evidence:[]})),attempts:[],defects:[]};
}
export function continuousPercentile(values, fraction) {
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b),at=(sorted.length-1)*fraction,low=Math.floor(at),high=Math.ceil(at);
 return sorted[low]+(sorted[high]-sorted[low])*(at-low);
}
/** Percent of ALL recorded attempts, not just successes. No timing is inferred from handler/SQL logs. */
export function speedCohort(attempts,nicheIds,cohort,platform=null) {
 const rows=attempts.filter(row=>row.cohort===cohort&&nicheIds.includes(row.nicheId)&&(!platform||row.platform===platform));
 const valid=row=>Number.isSafeInteger(row.openedAt)&&Number.isSafeInteger(row.liveAt)&&row.liveAt>=row.openedAt&&row.outcome==='confirmed_live'&&row.liveConfirmation==='seller_GetItem_Active'&&row.canonicalOccurrences===1&&row.photosRetained===true&&((row.platform==='web'&&row.clock==='browser_navigation')||(['android','ios'].includes(row.platform)&&row.clock==='native_process'));
 const timed=rows.filter(valid),times=timed.map(row=>row.liveAt-row.openedAt),within=times.filter(ms=>ms<=60000).length;
 return {cohort,platform:platform??'combined_do_not_compare_platforms',attempts:rows.length,confirmedLive:rows.filter(row=>row.outcome==='confirmed_live').length,samples:times.length,excludedConfirmedDurations:rows.filter(row=>row.outcome==='confirmed_live'&&!valid(row)).length,medianMs:continuousPercentile(times,.5),p90Ms:continuousPercentile(times,.9),publishedWithin60Pct:rows.length?within/rows.length*100:null,within60AmongTimedSuccessesPct:times.length?within/times.length*100:null,failedAttempts:rows.length?rows.filter(row=>row.outcome==='failed').length:null,unconfirmedAttempts:rows.length?rows.filter(row=>row.outcome==='unconfirmed').length:null,abandonedAttempts:rows.length?rows.filter(row=>row.outcome==='abandoned').length:null,manualInterventionItems:rows.length?rows.filter(row=>row.manualInterventions>0).length:null};
}
/** Artifact integrity is verified by the CLI. Human/device evidence still needs protected operator review. */
export function evaluateAcceptance(input,sourceSha,nicheIds,now=Date.now()) {
 const blockers=[];
 if(!sha.test(sourceSha??'')||input?.sourceSha!==sourceSha||input?.schemaVersion!==1)blockers.push('CURRENT_SOURCE_CONTRACT_REQUIRED');
 const checked=Date.parse(input?.checkedAt??'');
 if(!Number.isFinite(checked)||checked>now||now-checked>7*86400000)blockers.push('FRESH_NONFUTURE_EVIDENCE_REQUIRED');
 if(input?.review?.authorized!==true||input?.review?.sourceSha!==sourceSha)blockers.push('PROTECTED_OPERATOR_REVIEW_REQUIRED');
 if(!Array.isArray(nicheIds)||nicheIds.length!==13||new Set(nicheIds).size!==13||!nicheIds.includes('collectibles')||(!nicheIds.includes('tunes_flip') || !nicheIds.includes('stamps')))blockers.push('COMPLETE_THIRTEEN_NICHE_REGISTRY_REQUIRED');
 const suppliedRows=Array.isArray(input?.checks)?input.checks:[];
 const rows=suppliedRows.filter(row=>row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.id==='string'),seen=new Set();
 if(rows.length!==suppliedRows.length)blockers.push('MALFORMED_CHECK_EVIDENCE');
 for(const row of rows){if(seen.has(row.id))blockers.push('DUPLICATE_CHECK_EVIDENCE');seen.add(row.id);}
 const required=requiredChecks(nicheIds);
 const checks=required.map(id=>{
  const row=rows.find(value=>value.id===id);
  const artifacts=Array.isArray(row?.evidence)&&row.evidence.length>0&&row.evidence.every(ref=>typeof ref?.path==='string'&&ref.path.length>0&&hash.test(ref?.sha256??'')&&ref.verified===true);
  // Static contract/source inspection cannot certify a working user journey.
  const passed=row?.result==='PASS'&&row.observed===true&&row.kind==='runtime'&&Number.isSafeInteger(row.assertions)&&row.assertions>0&&row.sourceSha===sourceSha&&artifacts;
  if(!passed)blockers.push(`UNVERIFIED:${id}`);
  return {id,result:passed?'PASS':row?.result==='FAIL'?'FAIL':'BLOCKED'};
 });
 if(rows.some(row=>!required.includes(row.id)))blockers.push('UNKNOWN_CHECK_EVIDENCE');
 const attempts=Array.isArray(input?.attempts)?input.attempts:[],attemptIds=new Set();
 const validAttempts=attempts.filter(row=>{
  const valid=row&&typeof row.attemptRef==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(row.attemptRef)&&!attemptIds.has(row.attemptRef)&&row.sourceSha===sourceSha&&nicheIds.includes(row.nicheId)&&['listing_ready','research_review'].includes(row.cohort)&&['android','ios','web'].includes(row.platform)&&['confirmed_live','failed','unconfirmed','abandoned'].includes(row.outcome)&&Number.isSafeInteger(row.manualInterventions)&&row.manualInterventions>=0;
  if(valid)attemptIds.add(row.attemptRef);else blockers.push('INVALID_OR_DUPLICATE_TIMING_ATTEMPT');
  return valid;
 });
 const speed=nicheIds.flatMap(id=>['listing_ready','research_review'].flatMap(cohort=>['android','ios','web'].map(platform=>({nicheId:id,...speedCohort(validAttempts,[id],cohort,platform)}))));
 for(const id of nicheIds)if(!speed.some(row=>row.nicheId===id&&row.cohort==='listing_ready'&&row.samples>0))blockers.push(`OPEN_TO_LIVE_UNMEASURED:${id}`);
 if(speed.some(row=>row.excludedConfirmedDurations>0))blockers.push('INVALID_CONFIRMED_TIMING_EVIDENCE');
 if(!Array.isArray(input?.defects))blockers.push('DEFECT_REGISTER_REQUIRED');
 const defects=Array.isArray(input?.defects)?input.defects:[];
 if(defects.some(row=>!row||!['critical','high','medium','low'].includes(row.severity)||typeof row.resolved!=='boolean'))blockers.push('INVALID_DEFECT_EVIDENCE');
 if(defects.some(row=>['critical','high'].includes(row.severity)&&row.resolved!==true))blockers.push('OPEN_CRITICAL_OR_HIGH_DEFECTS');
 return {schemaVersion:1,sourceSha:sha.test(sourceSha??'')?sourceSha:null,checkedAt:new Date(now).toISOString(),acceptancePassed:blockers.length===0,releaseDecision:blockers.length?'BLOCKED':'ELIGIBLE_FOR_OWNER_RELEASE_REVIEW',deploymentPerformed:false,checks,blockers:[...new Set(blockers)],speed,note:'Evidence gate only. No automatic merge, upload, marketplace action or deployment. Eligibility is not a deployment confirmation.'};
}
