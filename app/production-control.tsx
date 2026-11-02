import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { classifyProductionWorkflowJob, summarizeProductionWorkflowJobs } from '@/services/productionControlEvidence';

const OWNER_REPO = 'troonvinyl-ux/SWISH';
const RAW = 'https://raw.githubusercontent.com/troonvinyl-ux/SWISH/main';
const API = 'https://api.github.com';
const GOLD = '#E6B83F';
const GREEN = '#43C98B';
const RED = '#F16F70';
const AMBER = '#F2B84B';

type Task = { id: string; title: string; status: string; evidence?: string };
type Stage = { id: string; name: string; status: string; goal: string; tasks: Task[] };
type Register = { programme: string; stages: Stage[]; knownReleaseRisks: string[]; nicheCertification: { source: string; requiredAreas: string[] } };
type Pull = { number: number; title: string; html_url: string; state: string; draft: boolean; mergeable: boolean | null; head: { ref: string; sha: string }; base: { ref: string; sha: string }; updated_at: string; user: { login: string }; body?: string; behindBy?: number; checkTotal?: number; checkPassed?: number; checkFailed?: number; checkPending?: number };
type Run = { id: number; name: string; display_title: string; html_url: string; status: string; conclusion: string | null; head_branch: string; head_sha: string; created_at: string };
type WorkflowJob = { id: number; name: string; status: string; conclusion: string | null; steps?: Array<{name:string;status:string;conclusion:string|null}> };
type WorkflowArtifact = { id:number; name:string; size_in_bytes:number; expired:boolean; created_at:string; expires_at:string };
type Niche = { id: string; name: string; entry?: string; specialists?: string[]; defaultSpecialist?: string };
type Snapshot = { register: Register | null; niches: Niche[]; pulls: Pull[]; openPullCount: number; runs: Run[]; webBuildRun: Run | null; webBuildJobs: WorkflowJob[]; routingRun: Run | null; routingJobs: WorkflowJob[]; webBuildArtifacts: WorkflowArtifact[]; mainSha: string; refreshedAt: string; errors: string[] };

// Public GitHub REST is unauthenticated in the client (60 requests/hour). Cache a refresh briefly and enrich only the eight newest PRs.
let cachedSnapshot: Snapshot | null = null;
let cachedSnapshotAt = 0;
const SNAPSHOT_CACHE_MS = 60_000;
const PR_DETAIL_LIMIT = 8;

const STAGES = [
  ['S1','Full architectural audit'],['S2','Foundation architecture and registry'],['S3','Foundation 1 — SWISH Core'],['S4','Foundation 2 — Standard resale workflow'],['S5','Foundation 3 — Niche specialisation'],['S6','Foundations 4–6 — Optional specialist capabilities'],['S7','Full production verification']
];

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} — ${url}`);
  return response.json() as Promise<T>;
}

function Pill({ label, tone = 'muted' }: { label: string; tone?: 'good'|'bad'|'warn'|'muted' }) {
  const color = tone === 'good' ? GREEN : tone === 'bad' ? RED : tone === 'warn' ? AMBER : '#A7B2C1';
  return <View style={[styles.pill,{ borderColor: color + '66', backgroundColor: color + '18' }]}><Text style={[styles.pillText,{ color }]}>{label}</Text></View>;
}

export default function ProductionControlScreen() {
  const { user } = useAuth();
  const { isMasterAdmin } = useApp();
  const insets = useSafeAreaInsets();
  const [snapshot,setSnapshot] = useState<Snapshot>({register:null,niches:[],pulls:[],openPullCount:0,runs:[],webBuildRun:null,webBuildJobs:[],routingRun:null,routingJobs:[],webBuildArtifacts:[],mainSha:'',refreshedAt:'',errors:[]});
  const [loading,setLoading] = useState(true);
  const [expanded,setExpanded] = useState<string>('S1');

  const refresh = useCallback(async (force = false) => {
    if (!force && cachedSnapshot && Date.now() - cachedSnapshotAt < SNAPSHOT_CACHE_MS) {
      setSnapshot(cachedSnapshot);
      setLoading(false);
      return;
    }
    setLoading(true);
    const errors: string[] = [];
    const settled = await Promise.allSettled([
      getJson<Register>(RAW + '/docs/SWISH_FOUNDATION_MASTER_REGISTER.json'),
      getJson<{products:Record<string,Niche>}>(RAW + '/niche-modules.json'),
      getJson<Pull[]>(API + '/repos/' + OWNER_REPO + '/pulls?state=open&per_page=100&sort=updated&direction=desc'),
      getJson<{workflow_runs:Run[]}>(API + '/repos/' + OWNER_REPO + '/actions/runs?per_page=20'),
      getJson<{sha:string}>(API + '/repos/' + OWNER_REPO + '/commits/main')
    ]);
    const value = <T,>(i:number): T | null => {
      const item = settled[i];
      if (item.status === 'fulfilled') return item.value as T;
      errors.push(String(item.reason));
      return null;
    };
    const register = value<Register>(0);
    const modules = value<{products:Record<string,Niche>}>(1);
    const rawPulls = value<Pull[]>(2) ?? [];
    const pulls = await Promise.all(rawPulls.slice(0,PR_DETAIL_LIMIT).map(async (p) => {
      const [comparison, checks] = await Promise.allSettled([
        getJson<{behind_by:number}>(API + '/repos/' + OWNER_REPO + '/compare/main...' + p.head.sha),
        getJson<{check_runs:Array<{status:string;conclusion:string|null}>}>(API + '/repos/' + OWNER_REPO + '/commits/' + p.head.sha + '/check-runs?per_page=100')
      ]);
      const compareData = comparison.status === 'fulfilled' ? comparison.value : null;
      const checkData = checks.status === 'fulfilled' ? checks.value.check_runs : [];
      if (comparison.status === 'rejected') errors.push('PR #' + p.number + ' comparison unavailable: ' + String(comparison.reason));
      if (checks.status === 'rejected') errors.push('PR #' + p.number + ' checks unavailable: ' + String(checks.reason));
      return {...p, behindBy:compareData?.behind_by, checkTotal:checkData.length,
        checkPassed:checkData.filter(x=>x.status==='completed' && x.conclusion==='success').length,
        checkFailed:checkData.filter(x=>x.status==='completed' && x.conclusion!=='success' && x.conclusion!=='skipped' && x.conclusion!=='neutral').length,
        checkPending:checkData.filter(x=>x.status!=='completed').length};
    }));
    const runs = value<{workflow_runs:Run[]}>(3);
    const main = value<{sha:string}>(4);
    const latestRuns = runs?.workflow_runs ?? [];
    const webBuildRun = latestRuns.find(r => /SWISH branded web production builds/i.test(r.name)) ?? null;
    const routingRun = latestRuns.find(r => /SWISH niche routing and branded config/i.test(r.name)) ?? null;
    let webBuildJobs: WorkflowJob[] = [];
    let webBuildArtifacts: WorkflowArtifact[] = [];
    let routingJobs: WorkflowJob[] = [];
    if (webBuildRun) {
      try {
        const jobPayload = await getJson<{jobs:WorkflowJob[]}>(API + '/repos/' + OWNER_REPO + '/actions/runs/' + webBuildRun.id + '/jobs?per_page=100');
        webBuildJobs = jobPayload.jobs ?? [];
        const artifactPayload = await getJson<{artifacts:WorkflowArtifact[]}>(API + '/repos/' + OWNER_REPO + '/actions/runs/' + webBuildRun.id + '/artifacts?per_page=100');
        webBuildArtifacts = artifactPayload.artifacts ?? [];
      } catch (error) {
        errors.push('Latest ten-niche web build job details unavailable: ' + String(error));
      }
    }
    if (routingRun) {
      try {
        const jobPayload = await getJson<{jobs:WorkflowJob[]}>(API + '/repos/' + OWNER_REPO + '/actions/runs/' + routingRun.id + '/jobs?per_page=100');
        routingJobs = jobPayload.jobs ?? [];
      } catch (error) {
        errors.push('Latest routing, regression and authorization evidence unavailable: ' + String(error));
      }
    }
    const nextSnapshot: Snapshot = {register,niches:Object.values(modules?.products ?? {}),pulls,openPullCount:rawPulls.length,runs:latestRuns,webBuildRun,webBuildJobs,routingRun,routingJobs,webBuildArtifacts,mainSha:main?.sha ?? '',refreshedAt:new Date().toISOString(),errors};
    cachedSnapshot = nextSnapshot;
    cachedSnapshotAt = Date.now();
    setSnapshot(nextSnapshot);
    setLoading(false);
  },[]);

  useEffect(() => { void refresh(); },[refresh]);
  if (!isSwishMasterAdmin(user?.email) || !isMasterAdmin) return <Redirect href={"/master-admin" as any} />;

  const stages = snapshot.register?.stages ?? [];
  const taskCounts = stages.flatMap(s=>s.tasks).reduce((a,t)=>{a[t.status]=(a[t.status]??0)+1;return a;},{} as Record<string,number>);
  const allTasks = stages.flatMap(s=>s.tasks);
  const verified = taskCounts['VERIFIED'] ?? 0;
  const readiness = allTasks.length ? Math.round(verified / allTasks.length * 100) : 0;
  const currentStage = stages.find(s=>s.status==='IN PROGRESS') ?? stages.find(s=>s.status!=='VERIFIED');
  const readyPulls = snapshot.pulls.filter(p=>p.mergeable===true && !p.draft).length;
  const failedRuns = snapshot.runs.filter(r=>r.conclusion==='failure').length;
  const webBuildSummary = summarizeProductionWorkflowJobs(snapshot.webBuildJobs);

  const open = (url:string) => { void Linking.openURL(url); };
  const taskTone = (status:string) => status==='VERIFIED'?'good':status==='BLOCKED'?'bad':status==='TESTING'?'warn':status==='IN PROGRESS'?'warn':'muted';
  const prAssessment = (p:Pull) => {
    if (p.mergeable === false) return {label:'CONFLICT / NOT MERGEABLE',tone:'bad' as const};
    if ((p.behindBy ?? 0) > 0) return {label:'BEHIND MAIN — UPDATE & RETEST',tone:'bad' as const};
    if ((p.checkFailed ?? 0) > 0) return {label:'CHECKS FAILING',tone:'bad' as const};
    if ((p.checkPending ?? 0) > 0) return {label:'CHECKS RUNNING',tone:'warn' as const};
    if (!p.checkTotal) return {label:'CHECKS NOT REPORTED',tone:'warn' as const};
    if (p.draft) return {label:'DRAFT — NOT READY',tone:'muted' as const};
    if (p.checkPassed === p.checkTotal && p.mergeable === true) return {label:'CHECKS PASS — REVIEW REQUIRED',tone:'good' as const};
    return {label:'RECHECK REQUIRED',tone:'warn' as const};
  };

  return <View style={styles.screen}>
    <StatusBar style="light" />
    <ScrollView contentContainerStyle={[styles.content,{paddingTop:insets.top+Spacing.lg,paddingBottom:insets.bottom+36}]} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => { void refresh(true); }} tintColor={GOLD}/>}>
      <View style={styles.topline}>
        <View style={{flex:1}}>
          <Text style={styles.eyebrow}>SWISH / OWNER OPERATIONS</Text>
          <Text style={styles.title}>Production Control</Text>
          <Text style={styles.subtitle}>One source of truth. Evidence before green.</Text>
        </View>
        <Pressable onPress={() => { void refresh(true); }} style={styles.refresh}><MaterialIcons name="refresh" size={23} color={GOLD}/></Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.heroRow}><View><Text style={styles.heroEyebrow}>MASTER PROGRAMME</Text><Text style={styles.heroTitle}>7-stage readiness</Text></View><Pill label="LIVE REPOSITORY" tone="good"/></View>
        <View style={styles.metrics}>
          <Metric label="VERIFIED TASKS" value={String(verified)} detail={`of ${allTasks.length} registered`}/>
          <Metric label="CURRENT STAGE" value={currentStage?.id ?? '—'} detail={currentStage?.name ?? 'No active stage'}/>
          <Metric label="OPEN PULL REQUESTS" value={String(snapshot.openPullCount)} detail={`Enriching latest ${snapshot.pulls.length}; ${readyPulls} mergeable`}/>
          <Metric label="FAILED RECENT RUNS" value={String(failedRuns)} detail="Latest 20 workflow runs"/>
        </View>
        <View style={styles.progressTrack}><View style={[styles.progressFill,{width:`${readiness}%`} as any]}/></View>
        <Text style={styles.progressNote}>{readiness}% tasks independently verified. Implemented and testing work does not count as production-ready.</Text>
      </View>

      <Section title="THE NEXT MOVE" subtitle="Work order from the master directive">
        <View style={styles.nextCard}>
          <Pill label={currentStage?.status ?? 'REGISTER UNAVAILABLE'} tone={currentStage?.status==='IN PROGRESS'?'warn':'muted'}/>
          <Text style={styles.nextTitle}>{currentStage?.name ?? 'Load the master register'}</Text>
          <Text style={styles.body}>{currentStage?.goal ?? 'The production register could not be loaded from the repository.'}</Text>
          {currentStage?.tasks.filter(t=>t.status!=='VERIFIED').slice(0,3).map(t=><View key={t.id} style={styles.nextTask}><MaterialIcons name="arrow-right" size={17} color={GOLD}/><Text style={styles.body}><Text style={{color:'#F4F6FA',fontWeight:'700'}}>{t.id}</Text> · {t.title}</Text></View>)}
        </View>
      </Section>

      <Pressable onPress={()=>open('https://github.com/'+OWNER_REPO+'/blob/main/docs/SWISH_MODULAR_PRODUCTION_MASTER_DIRECTIVE.md')} style={styles.directiveLink}>
        <MaterialIcons name="description" size={18} color={GOLD}/>
        <Text style={styles.directiveLinkText}>Open the canonical builder directive ↗</Text>
      </Pressable>

      <Section title="PROGRAMME STAGES" subtitle="Open a stage to inspect its acceptance tasks">
        {STAGES.map(([id,name])=>{
          const stage=stages.find(s=>s.id===id);
          const isOpen=expanded===id;
          return <View key={id} style={styles.stageCard}>
            <Pressable onPress={()=>setExpanded(isOpen?'':id)} style={styles.stageHead}>
              <View style={styles.stageIndex}><Text style={styles.stageIndexText}>{id}</Text></View>
              <View style={{flex:1}}><Text style={styles.stageTitle}>{name}</Text><Text style={styles.muted}>{stage?.tasks.filter(t=>t.status==='VERIFIED').length ?? 0}/{stage?.tasks.length ?? 0} verified</Text></View>
              <Pill label={stage?.status ?? 'NOT LOADED'} tone={taskTone(stage?.status ?? '')}/>
              <MaterialIcons name={isOpen?'expand-less':'expand-more'} size={22} color="#A7B2C1"/>
            </Pressable>
            {isOpen && <View style={styles.taskList}>{stage?.tasks.map(t=><View key={t.id} style={styles.taskRow}><View style={{flex:1}}><Text style={styles.taskTitle}>{t.id} · {t.title}</Text>{t.evidence?<Text style={styles.muted}>Evidence: {t.evidence}</Text>:null}</View><Pill label={t.status} tone={taskTone(t.status)}/></View>)}</View>}
          </View>;
        })}
      </Section>

      <Section title="NICHE READINESS" subtitle="Pulled from the canonical niche-modules.json registry">
        <View style={styles.nicheGrid}>{snapshot.niches.map(n=><View key={n.id} style={styles.nicheTile}><Text style={styles.nicheName}>{n.name}</Text><Text style={styles.muted}>{n.id}</Text><Pill label="CERTIFICATION PENDING" tone="warn"/></View>)}</View>
        <Text style={styles.muted}>Niche registration is not evidence of niche production readiness. Each product must pass the full certification matrix in the master register.</Text>
      </Section>

      <Section title="PULL REQUEST CONTROL" subtitle={`Latest ${snapshot.pulls.length} of ${snapshot.openPullCount} open PRs · stale-base and mergeability warnings`}>
        {snapshot.pulls.length===0?<Text style={styles.body}>No open pull requests returned, or GitHub API is unavailable.</Text>:snapshot.pulls.map(p=>{const a=prAssessment(p);return <Pressable key={p.number} onPress={()=>open(p.html_url)} style={styles.prCard}>
          <View style={styles.prTop}><Text style={styles.prNumber}>#{p.number}</Text><Pill label={a.label} tone={a.tone}/></View>
          <Text style={styles.prTitle}>{p.title}</Text><Text style={styles.muted}>{p.head.ref} → {p.base.ref} · {p.behindBy === undefined ? 'base comparison unavailable' : p.behindBy + ' commits behind main'} · checks {p.checkPassed ?? 0}/{p.checkTotal ?? 0} passed · updated {new Date(p.updated_at).toLocaleDateString()}</Text>
          <Text style={styles.prLink}>Open pull request ↗</Text>
        </Pressable>;})}
        <Text style={styles.warningText}>Important: a changed base SHA is a warning to recheck, not proof of a stale branch. Before merge, compare the PR head against current main and rerun required checks. This dashboard does not merge PRs automatically.</Text>
      </Section>

      <Section title="TEN-NICHE WEB BUILD SCORECARD" subtitle="Actual job and artifact results from the latest branded web production workflow">
        {snapshot.webBuildRun ? <View style={styles.nextCard}>
          <View style={styles.prTop}><Text style={styles.taskTitle}>{snapshot.webBuildRun.display_title || snapshot.webBuildRun.name}</Text><Pill label={snapshot.webBuildRun.status==='completed'?(snapshot.webBuildRun.conclusion ?? 'COMPLETED').toUpperCase():snapshot.webBuildRun.status.toUpperCase()} tone={snapshot.webBuildRun.conclusion==='success'?'good':snapshot.webBuildRun.conclusion==='failure'?'bad':'warn'}/></View>
          <View style={styles.metrics}>
            <Metric label="BUILD ARTEFACTS CONFIRMED" value={String(snapshot.webBuildArtifacts.filter(a=>!a.expired).length)} detail={`${snapshot.webBuildArtifacts.filter(a=>a.expired).length} expired artefacts`}/>
            <Metric label="EXPORT JOBS PASSED" value={String(webBuildSummary.passed)} detail={`of ${snapshot.webBuildJobs.length} reported jobs`}/>
            <Metric label="FAILED JOBS" value={String(webBuildSummary.failed)} detail="Completed with an error"/>
            <Metric label="PENDING JOBS" value={String(webBuildSummary.running + webBuildSummary.queued)} detail="Still running or queued"/>
          </View>
          {snapshot.webBuildArtifacts.length>0 ? <View style={{gap:5}}><Text style={styles.taskTitle}>GitHub-confirmed artefacts</Text>{snapshot.webBuildArtifacts.map(a=><View key={a.id} style={styles.runRow}><View style={{flex:1}}><Text style={styles.taskTitle}>{a.name}</Text><Text style={styles.muted}>{(a.size_in_bytes/1024/1024).toFixed(1)} MB · expires {new Date(a.expires_at).toLocaleDateString()}</Text></View><Pill label={a.expired?'EXPIRED':'AVAILABLE'} tone={a.expired?'bad':'good'}/></View>)}</View> : <Text style={styles.body}>No downloadable build artefacts are currently confirmed for this run.</Text>}
          {snapshot.webBuildJobs.length===0 ? <Text style={styles.body}>GitHub has not returned job details for this run. No build result is inferred.</Text> : snapshot.webBuildJobs.map(j=>{
            const artifact=j.steps?.find(s=>/upload web build artifact/i.test(s.name));
            const state=classifyProductionWorkflowJob(j);
            const passed=state==='PASSED';
            const tone=state==='PASSED'?'good':state==='FAILED'?'bad':state==='SKIPPED'?'muted':'warn';
            return <View key={j.id} style={styles.runRow}>
              <View style={{flex:1}}><Text style={styles.taskTitle}>{j.name.replace(/^Export web — /,'')}</Text><Text style={styles.muted}>Artifact: {artifact?.conclusion==='success'?'uploaded':artifact?.status==='in_progress'?'uploading':artifact?.conclusion==='failure'?'failed':'not confirmed'}</Text></View>
              <Pill label={state.replace('_',' ')} tone={tone}/>
            </View>;
          })}
          <Text style={styles.warningText}>A successful static export proves the web bundle built and its workflow artifact uploaded. It does not prove live deployment, authentication, tenant isolation, eBay transactions or real-device acceptance.</Text>
          <Pressable onPress={()=>open(snapshot.webBuildRun!.html_url)} style={styles.externalLink}><Text style={styles.externalLinkText}>Inspect source workflow and logs ↗</Text></Pressable>
        </View> : <Text style={styles.body}>No branded ten-niche web production workflow was found in the latest 20 GitHub runs.</Text>}
      </Section>

      <Section title="REGRESSION, SECURITY & NATIVE EVIDENCE" subtitle="Live step results from the latest niche-routing validation workflow">
        {snapshot.routingRun ? <View style={styles.nextCard}>
          <View style={styles.prTop}><Text style={styles.taskTitle}>{snapshot.routingRun.display_title || snapshot.routingRun.name}</Text><Pill label={snapshot.routingRun.status==='completed'?(snapshot.routingRun.conclusion ?? 'COMPLETED').toUpperCase():snapshot.routingRun.status.toUpperCase()} tone={snapshot.routingRun.conclusion==='success'?'good':snapshot.routingRun.conclusion==='failure'?'bad':'warn'}/></View>
          {snapshot.routingJobs.map(job=>{
            const checks=[
              {label:'Full regression suite',match:/complete regression suite/i},
              {label:'Server authorization boundary tests',match:/shared server authorization boundaries/i},
              {label:'Android production JavaScript bundle',match:/bundle android production javascript/i},
              {label:'Ten Expo branded configurations',match:/validate all ten expo branded configurations/i}
            ];
            return <View key={job.id} style={{gap:8}}>
              <Text style={styles.muted}>{job.name}</Text>
              {checks.map(check=>{
                const step=job.steps?.find(s=>check.match.test(s.name));
                const done=step?.status==='completed';
                const success=done && step?.conclusion==='success';
                const failed=done && !success && step?.conclusion!=='skipped' && step?.conclusion!=='neutral';
                return <View key={check.label} style={styles.runRow}>
                  <View style={{flex:1}}><Text style={styles.taskTitle}>{check.label}</Text><Text style={styles.muted}>{step ? (success?'Completed successfully':failed?'Completed with failure':step.status==='in_progress'?'Currently running':'Waiting') : 'No matching step reported by workflow'}</Text></View>
                  <Pill label={success?'PASSED':failed?'FAILED':step?.status==='in_progress'?'RUNNING':'PENDING'} tone={success?'good':failed?'bad':'warn'}/>
                </View>;
              })}
            </View>;
          })}
          <Text style={styles.warningText}>These are workflow-step results, not a substitute for a full penetration test, live authorization review, installed-device acceptance or app-store/release verification.</Text>
          <Pressable onPress={()=>open(snapshot.routingRun!.html_url)} style={styles.externalLink}><Text style={styles.externalLinkText}>Inspect regression and authorization workflow ↗</Text></Pressable>
        </View> : <Text style={styles.body}>No niche-routing validation workflow was found in the latest 20 GitHub runs.</Text>}
      </Section>

      <Section title="CI / RELEASE SIGNALS" subtitle="Latest GitHub Actions workflow runs">
        {snapshot.runs.slice(0,10).map(r=><Pressable key={r.id} onPress={()=>open(r.html_url)} style={styles.runRow}>
          <View style={{flex:1}}><Text style={styles.taskTitle}>{r.display_title || r.name}</Text><Text style={styles.muted}>{r.head_branch} · {new Date(r.created_at).toLocaleString()}</Text></View>
          <Pill label={r.status==='completed'?(r.conclusion??'COMPLETED').toUpperCase():r.status.toUpperCase()} tone={r.conclusion==='success'?'good':r.conclusion==='failure'?'bad':'warn'}/>
        </Pressable>)}
        <Pressable onPress={()=>open('https://github.com/'+OWNER_REPO+'/actions')} style={styles.externalLink}><Text style={styles.externalLinkText}>Open all GitHub Actions ↗</Text></Pressable>
      </Section>

      <Section title="KNOWN RELEASE BLOCKERS" subtitle="Carried forward from the engineering handover">
        {(snapshot.register?.knownReleaseRisks ?? []).map((risk,i)=><View key={i} style={styles.riskRow}><MaterialIcons name="warning-amber" size={18} color={AMBER}/><Text style={styles.body}>{risk}</Text></View>)}
      </Section>

      {snapshot.errors.length>0?<View style={styles.errorBox}><Text style={styles.errorTitle}>Some live sources could not be loaded</Text>{snapshot.errors.map((e,i)=><Text key={i} style={styles.muted}>{e}</Text>)}</View>:null}
      <Text style={styles.footer}>Last refreshed: {snapshot.refreshedAt ? new Date(snapshot.refreshedAt).toLocaleString() : 'Loading'} · Source: github.com/{OWNER_REPO}</Text>
    </ScrollView>
  </View>;
}

function Metric({label,value,detail}:{label:string;value:string;detail:string}) { return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricDetail}>{detail}</Text></View>; }
function Section({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}) { return <View style={styles.section}><View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.sectionSubtitle}>{subtitle}</Text></View>{children}</View>; }

const styles=StyleSheet.create({
  screen:{flex:1,backgroundColor:'#090D13'},content:{paddingHorizontal:Spacing.base,gap:Spacing.lg,maxWidth:1100,width:'100%',alignSelf:'center'},
  topline:{flexDirection:'row',alignItems:'center',gap:12},eyebrow:{color:GOLD,fontSize:10,fontWeight:'900',letterSpacing:2},title:{color:'#F5F7FA',fontSize:30,fontWeight:'900',marginTop:4},subtitle:{color:'#9BA8B8',fontSize:13,marginTop:3},
  refresh:{width:46,height:46,borderRadius:14,backgroundColor:'#18212D',alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:'#303D4D'},
  hero:{backgroundColor:'#121B27',borderColor:'#334253',borderWidth:1,borderRadius:22,padding:18,gap:16},heroRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},heroEyebrow:{fontSize:9,color:GOLD,fontWeight:'900',letterSpacing:1.5},heroTitle:{fontSize:22,color:'#F5F7FA',fontWeight:'900',marginTop:4},
  metrics:{flexDirection:'row',flexWrap:'wrap',gap:10},metric:{backgroundColor:'#1B2735',borderRadius:13,padding:12,minWidth:Platform.OS==='web'?190:'46%',flexGrow:1,gap:4},metricLabel:{fontSize:9,color:'#9EADBD',fontWeight:'800',letterSpacing:1},metricValue:{fontSize:25,color:'#F6F7FA',fontWeight:'900'},metricDetail:{fontSize:10,color:'#9EADBD'},
  progressTrack:{height:8,borderRadius:8,backgroundColor:'#2C3948',overflow:'hidden'},progressFill:{height:8,borderRadius:8,backgroundColor:GREEN},progressNote:{color:'#AAB5C2',fontSize:11,lineHeight:17},
  directiveLink:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,padding:13,borderRadius:12,borderWidth:1,borderColor:'#6D592A',backgroundColor:'#211C13'},directiveLinkText:{color:GOLD,fontSize:11,fontWeight:'900'},
  section:{gap:10},sectionHeading:{gap:3},sectionTitle:{fontSize:15,color:'#F1F4F8',fontWeight:'900',letterSpacing:.5},sectionSubtitle:{fontSize:10,color:'#8593A4'},
  nextCard:{backgroundColor:'#151F2B',borderRadius:16,borderWidth:1,borderColor:'#3A4655',padding:16,gap:10},nextTitle:{fontSize:19,color:'#F5F7FA',fontWeight:'900'},body:{fontSize:12,color:'#B9C4D0',lineHeight:18},nextTask:{flexDirection:'row',gap:5,alignItems:'flex-start'},
  stageCard:{backgroundColor:'#121A25',borderRadius:14,borderWidth:1,borderColor:'#293545',overflow:'hidden'},stageHead:{padding:13,flexDirection:'row',alignItems:'center',gap:10},stageIndex:{width:35,height:35,borderRadius:10,backgroundColor:'#2B2619',alignItems:'center',justifyContent:'center'},stageIndexText:{color:GOLD,fontWeight:'900',fontSize:11},stageTitle:{color:'#F0F3F7',fontSize:12,fontWeight:'800'},muted:{color:'#8593A4',fontSize:10,marginTop:3},taskList:{paddingHorizontal:13,paddingBottom:10,gap:10},taskRow:{paddingTop:10,borderTopWidth:1,borderTopColor:'#283443',flexDirection:'row',alignItems:'center',gap:8},taskTitle:{color:'#E6EBF1',fontSize:11,fontWeight:'700',lineHeight:16},
  pill:{borderRadius:20,borderWidth:1,paddingHorizontal:8,paddingVertical:4,alignSelf:'flex-start'},pillText:{fontSize:8,fontWeight:'900',letterSpacing:.4},
  nicheGrid:{flexDirection:'row',flexWrap:'wrap',gap:9},nicheTile:{backgroundColor:'#121A25',borderRadius:13,borderWidth:1,borderColor:'#293545',padding:12,gap:5,minWidth:Platform.OS==='web'?180:'46%',flexGrow:1},nicheName:{fontSize:12,color:'#F0F3F7',fontWeight:'800'},
  prCard:{backgroundColor:'#121A25',borderRadius:13,borderWidth:1,borderColor:'#293545',padding:13,gap:6},prTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},prNumber:{color:GOLD,fontWeight:'900',fontSize:12},prTitle:{color:'#F0F3F7',fontSize:13,fontWeight:'800'},prLink:{color:GOLD,fontSize:10,fontWeight:'800'},
  warningText:{color:'#E7BB68',fontSize:10,lineHeight:16,backgroundColor:'#352A18',padding:11,borderRadius:10},runRow:{flexDirection:'row',alignItems:'center',gap:10,padding:11,backgroundColor:'#121A25',borderRadius:11,borderWidth:1,borderColor:'#293545'},externalLink:{padding:12,alignItems:'center'},externalLinkText:{color:GOLD,fontWeight:'800',fontSize:12},
  riskRow:{flexDirection:'row',gap:9,alignItems:'flex-start',backgroundColor:'#171C22',borderRadius:10,padding:11},errorBox:{backgroundColor:'#351D22',borderColor:'#7D333C',borderWidth:1,borderRadius:12,padding:12,gap:5},errorTitle:{color:'#FF9A9E',fontWeight:'900',fontSize:12},footer:{color:'#667587',fontSize:9,textAlign:'center',paddingVertical:8}
});
