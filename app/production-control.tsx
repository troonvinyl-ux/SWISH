import { memo, useCallback, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAlert, useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { useProductionControl } from '@/hooks/useProductionControl';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';
import { classifyProductionWorkflowJob } from '@/services/productionControlEvidence';
import { PRODUCTION_REPOSITORY } from '@/services/productionControlService';

const github = `https://github.com/${PRODUCTION_REPOSITORY}`;
const sections = ['next', 'stages', 'certification', 'pulls', 'workflows', 'runs', 'risks'] as const;
type SectionId = typeof sections[number];
type Tone = 'good' | 'bad' | 'warn' | 'muted';
const statusTone = (status: string): Tone => status === 'VERIFIED' || status === 'PASSED' ? 'good' : status === 'FAILED' || status === 'BLOCKED' ? 'bad' : ['NOT STARTED', 'SKIPPED'].includes(status) ? 'muted' : 'warn';

interface PillProps { label: string; tone?: Tone }
const Pill = memo(function Pill({ label, tone = 'muted' }: PillProps) {
  const color = tone === 'good' ? Colors.success : tone === 'bad' ? Colors.danger : tone === 'warn' ? Colors.warning : Colors.textSecondary;
  return <View style={[styles.pill, { borderColor: color, backgroundColor: color + '16' }]}><Text style={[styles.pillText, { color }]}>{label}</Text></View>;
});
interface MetricProps { label: string; value: string; detail: string }
const Metric = memo(function Metric({ label, value, detail }: MetricProps) {
  return <View style={styles.metric}><Text style={styles.muted}>{label}</Text><Text style={styles.metricValue}>{value}</Text><Text style={styles.muted}>{detail}</Text></View>;
});
interface SectionProps { title: string; subtitle: string; children: ReactNode }
function Section({ title, subtitle, children }: SectionProps) {
  return <View style={styles.section}><View style={styles.heading}><Text style={styles.sectionTitle}>{title}</Text><Text style={styles.body}>{subtitle}</Text></View>{children}</View>;
}

export default function ProductionControlScreen() {
  const { user, loading: authLoading } = useAuth();
  const { isMasterAdmin, tenantLoading, nichePreferencesLoading } = useApp();
  const accessLoading = authLoading || tenantLoading || nichePreferencesLoading;
  const ownerAccessDenied = !isSwishMasterAdmin(user?.email) || !isMasterAdmin;
  const allowed = !accessLoading && !ownerAccessDenied;
  // Hook is always mounted, but it cannot fetch repository data before owner authorization.
  const control = useProductionControl(allowed);
  const router = useRouter();
  const { showAlert } = useAlert();
  const { snapshot, loading, refresh, overview, selectedNiche, setSelectedNicheId, expandedStageId, setExpandedStageId } = control;
  const refreshNow = useCallback(() => { void refresh(true); }, [refresh]);
  const back = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/master-admin' as any);
  }, [router]);
  const open = useCallback((url: string) => {
    if (!url.startsWith(github + '/')) { showAlert('Link unavailable', 'The source link is not part of the canonical repository.'); return; }
    void Linking.openURL(url).catch(() => showAlert('Unable to open source', 'Please try again or open the repository in your browser.'));
  }, [showAlert]);

  if (accessLoading) return <SafeAreaView style={styles.loading}><ActivityIndicator color={Colors.primary}/><Text style={styles.body}>Checking owner access…</Text></SafeAreaView>;
  if (!allowed) return <Redirect href={"/master-admin" as any} />;
  const sourceLabel = snapshot.source === 'LIVE' ? 'LIVE REGISTER' : snapshot.source === 'CACHED' ? 'CACHED EVIDENCE' : 'BUNDLED / OFFLINE';

  const renderSection = ({ item }: { item: SectionId }) => {
    if (item === 'next') return <Section title="Next acceptance work" subtitle="The first unfinished programme stage, not the latest green workflow.">
      <View style={styles.card}>
        <Pill label={overview.currentStage?.status ?? (overview.tasks.length ? 'REVIEW RELEASE GATES' : 'REGISTER UNAVAILABLE')} tone="warn"/>
        <Text style={styles.cardTitle}>{overview.currentStage?.name ?? 'Review the certification matrix'}</Text>
        <Text style={styles.body}>{overview.currentStage?.goal ?? 'Record real deployment, security and device results before making a release decision.'}</Text>
        {overview.currentStage?.tasks.filter(task => task.status !== 'VERIFIED').slice(0, 3).map(task => <View key={task.id} style={styles.row}><MaterialIcons name="arrow-forward" size={18} color={Colors.primary}/><Text style={styles.rowText}>{task.id} · {task.title}</Text></View>)}
        <Pressable accessibilityRole="link" onPress={() => open(`${github}/blob/main/docs/SWISH_FOUNDATION_MASTER_REGISTER.json`)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}><Text style={styles.linkText}>Open canonical master register</Text><MaterialIcons name="open-in-new" size={18} color={Colors.primary}/></Pressable>
      </View>
    </Section>;

    if (item === 'stages') return <Section title="Programme stages" subtitle="Task completion is historical register evidence, not a live production certification.">
      {overview.stages.map(stage => {
        const expanded = expandedStageId === stage.id;
        return <View key={stage.id} style={styles.card}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Inspect ${stage.id}: ${stage.name}`} accessibilityState={{ expanded }} onPress={() => setExpandedStageId(expanded ? '' : stage.id)} style={({ pressed }) => [styles.wrapRow, styles.stageButton, pressed && styles.pressed]}>
            <View style={styles.index}><Text style={styles.indexText}>{stage.id}</Text></View>
            <View style={styles.copy}><Text style={styles.cardTitle}>{stage.name}</Text><Text style={styles.muted}>{stage.tasks.filter(task => task.status === 'VERIFIED').length} / {stage.tasks.length} register-verified</Text></View>
            <Pill label={stage.status} tone={statusTone(stage.status)}/><MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={24} color={Colors.textSecondary}/>
          </Pressable>
          {expanded ? <View style={styles.taskList}>{stage.tasks.map(task => <View key={task.id} style={styles.task}>
            <View style={styles.wrapRow}><Text style={styles.rowText}>{task.id} · {task.title}</Text><Pill label={task.status} tone={statusTone(task.status)}/></View>
            <Text selectable style={styles.body}>{task.evidence ? `Evidence: ${task.evidence}` : 'No acceptance evidence recorded.'}</Text>
          </View>)}</View> : null}
        </View>;
      })}
      {overview.stages.length === 0 ? <Text style={styles.body}>No valid register is available. Readiness cannot be calculated.</Text> : null}
    </Section>;

    if (item === 'certification') return <Section title="Ten-niche certification" subtitle={`${overview.gatesVerified} / ${overview.gatesTotal} current-commit acceptance gates · ${overview.certified} / ${snapshot.niches.length} certified niches`}>
      <Text style={styles.body}>Only explicit, dated niche evidence for the loaded main commit counts. Missing records stay open; older or offline evidence requires recheck.</Text>
      <View style={styles.nicheRail}><FlatList horizontal data={overview.certifications} keyExtractor={niche => niche.id} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.railContent} renderItem={({ item: niche }) => <Pressable accessibilityRole="button" accessibilityState={{ selected: selectedNiche?.id === niche.id }} onPress={() => setSelectedNicheId(niche.id)} style={({ pressed }) => [styles.nicheChip, selectedNiche?.id === niche.id && styles.selectedChip, pressed && styles.pressed]}>
        <Text style={styles.chipTitle}>{niche.name}</Text><Text style={styles.muted}>{niche.verified} / {niche.total} verified</Text>
      </Pressable>}/></View>
      {selectedNiche ? <View style={styles.card}>
        <View style={styles.wrapRow}><View style={styles.copy}><Text style={styles.cardTitle}>{selectedNiche.name}</Text><Text style={styles.muted}>{selectedNiche.id}</Text></View><Pill label={selectedNiche.certified ? 'CERTIFIED IN REGISTER' : 'NOT CERTIFIED'} tone={selectedNiche.certified ? 'good' : 'warn'}/></View>
        {selectedNiche.gates.map(gate => <View key={gate.area} style={styles.task}>
          <View style={styles.wrapRow}><Text style={styles.rowText}>{gate.area.replace(/-/g, ' ')}</Text><Pill label={gate.status} tone={statusTone(gate.status)}/></View>
          <Text selectable style={styles.body}>{gate.record?.evidence ?? 'Niche-specific acceptance evidence has not been recorded.'}</Text>
          {gate.record?.commitSha ? <Text style={styles.muted}>Tested commit {gate.record.commitSha.slice(0, 10)} · {gate.record.verifiedAt ?? 'Timestamp missing'}</Text> : null}
        </View>)}
      </View> : <Text style={styles.body}>No valid niche registry is available.</Text>}
    </Section>;

    if (item === 'pulls') return <Section title="Pull request control" subtitle={snapshot.openPullCount === null ? 'Open PR count unavailable' : `${snapshot.openPullCount}${snapshot.pullCountTruncated ? '+' : ''} open main-targeted PRs · newest ${snapshot.pulls.length} inspected`}>
      {overview.pulls.map(pull => <Pressable key={pull.number} accessibilityRole="link" onPress={() => open(pull.html_url)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.wrapRow}><Text style={styles.indexText}>#{pull.number}</Text><Pill label={pull.assessment.label} tone={pull.assessment.tone}/></View>
        <Text style={styles.cardTitle}>{pull.title}</Text><Text style={styles.body}>{pull.head.ref} → {pull.base.ref}</Text>
        <Text style={styles.muted}>{pull.behindBy === undefined ? 'Base comparison unavailable' : `${pull.behindBy} commits behind loaded main`} · checks {pull.checkPassed ?? 0} / {pull.checkTotal ?? 0} passed</Text>
      </Pressable>)}
      {snapshot.openPullCount === 0 ? <Text style={styles.body}>No open main-targeted pull requests were returned.</Text> : snapshot.pulls.length === 0 ? <Text style={styles.body}>Pull-request evidence is unavailable. This is not a zero-PR confirmation.</Text> : null}
      <Text style={styles.warning}>Check summaries are not branch-protection or approval guarantees. Recheck latest main and required checks before merge. This panel never merges PRs.</Text>
    </Section>;

    if (item === 'workflows') return <Section title="Build and acceptance evidence" subtitle="Canonical workflow files, main-branch runs and explicit tested commits.">
      {overview.workflows.map(workflow => <View key={workflow.label} style={styles.card}>
        <Text style={styles.cardTitle}>{workflow.label}</Text>
        {workflow.run ? <>
          <View style={styles.wrapRow}><Pill label={classifyProductionWorkflowJob(workflow.run)} tone={workflow.current ? statusTone(classifyProductionWorkflowJob(workflow.run)) : 'warn'}/><Pill label={workflow.current ? 'LOADED MAIN COMMIT' : 'OLDER / UNCONFIRMED COMMIT'} tone={workflow.current ? 'muted' : 'warn'}/></View>
          <Text style={styles.body}>Tested {workflow.run.head_sha.slice(0, 10)} · {new Date(workflow.run.created_at).toLocaleString()}</Text>
          <Text style={styles.muted}>{workflow.summary.passed} passed · {workflow.summary.failed} failed · {workflow.summary.running + workflow.summary.queued} pending · {workflow.summary.skipped} skipped jobs</Text>
          {workflow.jobs.length === 0 ? <Text style={styles.body}>Job evidence not reported. No result is inferred.</Text> : workflow.jobs.map(job => <View key={job.id} style={styles.task}>
            <View style={styles.wrapRow}><Text style={styles.rowText}>{job.name}</Text><Pill label={classifyProductionWorkflowJob(job)} tone={statusTone(classifyProductionWorkflowJob(job))}/></View>
            {job.steps?.filter(step => /complete regression suite|shared server authorization boundaries|bundle android production javascript|validate all ten expo branded|validate production register/i.test(step.name)).map(step => <View key={step.name} style={styles.wrapRow}><Text style={styles.body}>{step.name}</Text><Pill label={classifyProductionWorkflowJob(step)} tone={statusTone(classifyProductionWorkflowJob(step))}/></View>)}
          </View>)}
          {workflow.label === 'Ten-niche web builds' ? <View style={styles.task}>
            <Text style={styles.cardTitle}>Build artifacts</Text>
            {workflow.artifacts.length === 0 ? <Text style={styles.body}>No downloadable artifacts are confirmed.</Text> : workflow.artifacts.map(artifact => {
              const expiry = Date.parse(artifact.expires_at);
              const expired = artifact.expired || expiry <= Date.now();
              const available = !expired && Number.isFinite(expiry) && artifact.size_in_bytes > 0;
              return <View key={artifact.id} style={styles.wrapRow}><View style={styles.copy}><Text style={styles.rowText}>{artifact.name}</Text><Text style={styles.muted}>{(artifact.size_in_bytes / 1024 / 1024).toFixed(1)} MB · expires {new Date(artifact.expires_at).toLocaleDateString()}</Text></View><Pill label={expired ? 'EXPIRED' : available ? 'AVAILABLE' : 'NOT CONFIRMED'} tone={expired ? 'bad' : 'muted'}/></View>;
            })}
          </View> : null}
          <Pressable accessibilityRole="link" onPress={() => open(workflow.run!.html_url)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}><Text style={styles.linkText}>Inspect workflow and logs</Text><MaterialIcons name="open-in-new" size={18} color={Colors.primary}/></Pressable>
        </> : <Text style={styles.body}>No eligible main-branch run was reported for this workflow.</Text>}
        {workflow.errors.map((error, index) => <Text key={index} style={styles.error}>{error}</Text>)}
      </View>)}
      {overview.workflows.length === 0 ? <Text style={styles.body}>Live workflow evidence has not been loaded.</Text> : null}
      <Text style={styles.warning}>A successful export, uploaded artifact or Android JavaScript bundle does not prove deployment, a signed release, installed-device behavior, tenant isolation or real eBay transactions.</Text>
    </Section>;

    if (item === 'runs') return <Section title="Recent main-branch workflows" subtitle="Recent signals remain separate from niche certification.">
      {snapshot.runs.filter(run => run.event !== 'pull_request').slice(0, 10).map(run => <Pressable key={run.id} accessibilityRole="link" onPress={() => open(run.html_url)} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
        <View style={styles.wrapRow}><Text style={styles.rowText}>{run.display_title || run.name}</Text><Pill label={classifyProductionWorkflowJob(run)} tone={run.head_sha === snapshot.mainSha && snapshot.source === 'LIVE' ? statusTone(classifyProductionWorkflowJob(run)) : 'warn'}/></View>
        <Text style={styles.muted}>{run.head_sha.slice(0, 10)} · {new Date(run.created_at).toLocaleString()}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="link" onPress={() => open(`${github}/actions`)} style={({ pressed }) => [styles.link, pressed && styles.pressed]}><Text style={styles.linkText}>Open all GitHub Actions</Text><MaterialIcons name="open-in-new" size={18} color={Colors.primary}/></Pressable>
    </Section>;

    return <Section title="Known release blockers" subtitle="Carried forward without silently closing unresolved work.">
      {overview.risks.map(risk => <View key={risk} style={styles.risk}><MaterialIcons name="warning-amber" size={22} color={Colors.warning}/><Text style={styles.rowText}>{risk}</Text></View>)}
      {overview.risks.length === 0 ? <Text style={styles.body}>{snapshot.register ? 'No release risks recorded. This alone does not certify production.' : 'Release blockers cannot be loaded.'}</Text> : null}
    </Section>;
  };

  return <SafeAreaView edges={['top', 'bottom']} style={styles.screen}>
    <StatusBar style="light"/>
    <FlatList data={sections} keyExtractor={item => item} renderItem={renderSection} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={refreshNow} tintColor={Colors.primary}/>} ListHeaderComponent={<View style={styles.header}>
      <View style={styles.topline}>
        <Pressable accessibilityRole="button" accessibilityLabel="Return to Master Admin" onPress={back} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}><MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary}/></Pressable>
        <View style={styles.copy}><Text style={styles.eyebrow}>SWISH / OWNER OPERATIONS</Text><Text style={styles.title}>Production Control</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Refresh production evidence" disabled={loading} accessibilityState={{ disabled: loading }} onPress={refreshNow} style={({ pressed }) => [styles.iconButton, (pressed || loading) && styles.pressed]}>{loading ? <ActivityIndicator color={Colors.primary}/> : <MaterialIcons name="refresh" size={24} color={Colors.primary}/>}</Pressable>
      </View>
      <View style={styles.hero}>
        <View style={styles.wrapRow}><Text style={styles.cardTitle}>Evidence before release</Text><Pill label={sourceLabel} tone={snapshot.source === 'LIVE' ? 'muted' : 'warn'}/></View>
        <Pill label={overview.verdict} tone={overview.complete ? 'good' : snapshot.source === 'LIVE' && overview.risks.length ? 'bad' : 'warn'}/>
        <View style={styles.metrics}>
          <Metric label="REGISTER-VERIFIED TASKS" value={snapshot.register ? `${overview.verified} / ${overview.tasks.length}` : '—'} detail="Historical evidence, not certification"/>
          <Metric label="CERTIFIED NICHES" value={`${overview.certified} / ${snapshot.niches.length}`} detail={`${overview.gatesVerified} / ${overview.gatesTotal} current gates`}/>
          <Metric label="NEXT STAGE" value={overview.currentStage?.id ?? '—'} detail={overview.currentStage?.name ?? 'Review acceptance'}/>
          <Metric label="BLOCKED TASKS" value={String(overview.blocked)} detail={`${overview.risks.length} recorded release risks`}/>
        </View>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: overview.readiness }} accessibilityLabel="Programme task completion, not production readiness" style={styles.progressTrack}><View style={[styles.progressFill, { width: `${overview.readiness}%` }]}/></View>
        <Text style={styles.body}>{overview.readiness}% of programme tasks are register-verified. Build success and implemented work do not make a product production-ready.</Text>
        <Text style={styles.muted}>{snapshot.mainSha ? `Loaded main ${snapshot.mainSha.slice(0, 10)}` : 'Main commit not confirmed'} · {snapshot.refreshedAt ? `Evidence loaded ${new Date(snapshot.refreshedAt).toLocaleString()}` : 'Using the register packaged with this app'}</Text>
      </View>
      {snapshot.errors.length > 0 ? <View style={styles.errorBox}><View style={styles.row}><MaterialIcons name="error-outline" size={22} color={Colors.danger}/><Text style={styles.cardTitle}>Some evidence sources are unavailable</Text></View>{snapshot.errors.slice(0, 6).map((error, index) => <Text key={index} style={styles.body}>{error}</Text>)}</View> : null}
      {snapshot.source !== 'LIVE' ? <Text style={styles.warning}>Cached or bundled evidence is shown for continuity. It cannot confirm current-main readiness. No statuses have been promoted.</Text> : null}
      {snapshot.retryAt > Date.now() ? <Text style={styles.warning}>Refresh cooldown / GitHub rate limit. Retry after {new Date(snapshot.retryAt).toLocaleTimeString()}.</Text> : null}
    </View>} ListFooterComponent={<Text style={styles.footer}>Read-only repository evidence · {PRODUCTION_REPOSITORY}{'\n'}Repeated refreshes are cached and rate-limited. No credentials or automatic release actions.</Text>}/>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  loading: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center', gap: Spacing.base },
  content: { padding: Spacing.base, gap: Spacing.xl, maxWidth: 960, width: '100%', alignSelf: 'center', paddingBottom: Spacing.xxl },
  header: { gap: Spacing.base }, topline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  copy: { flex: 1, minWidth: 120, gap: Spacing.xs },
  iconButton: { minWidth: 48, height: 48, borderRadius: Radius.md, backgroundColor: Colors.surfaceElevated, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.surfaceBorder },
  eyebrow: { color: Colors.primary, fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, letterSpacing: 1 },
  title: { fontSize: Typography.size.lg, color: Colors.textPrimary, fontWeight: Typography.weight.bold, includeFontPadding: false },
  hero: { backgroundColor: Colors.surfaceElevated, borderRadius: Radius.xl, borderWidth: 1, borderColor: Colors.gold + '66', padding: Spacing.base, gap: Spacing.base },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  metric: { flexGrow: 1, flexBasis: '46%', padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.surface, gap: Spacing.sm },
  metricValue: { fontSize: Typography.size.xl, fontWeight: Typography.weight.bold, color: Colors.textPrimary, includeFontPadding: false },
  progressTrack: { height: Spacing.sm, borderRadius: Radius.pill, backgroundColor: Colors.surfaceHighlight, overflow: 'hidden' },
  progressFill: { height: Spacing.sm, backgroundColor: Colors.primary },
  heading: { gap: Spacing.sm }, section: { gap: Spacing.md },
  sectionTitle: { color: Colors.textPrimary, fontSize: Typography.size.md, fontWeight: Typography.weight.bold, includeFontPadding: false },
  card: { padding: Spacing.base, gap: Spacing.md, backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder },
  cardTitle: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, lineHeight: 26, flexShrink: 1, includeFontPadding: false },
  body: { fontSize: Typography.size.base, color: Colors.textSecondary, lineHeight: 26, flexShrink: 1, includeFontPadding: false },
  muted: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 21, flexShrink: 1, includeFontPadding: false },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.sm },
  rowText: { flex: 1, minWidth: 120, color: Colors.textPrimary, fontSize: Typography.size.base, lineHeight: 26, includeFontPadding: false },
  index: { width: 40, height: 40, borderRadius: Radius.sm, backgroundColor: Colors.goldDim, alignItems: 'center', justifyContent: 'center' },
  indexText: { color: Colors.gold, fontWeight: Typography.weight.bold, fontSize: Typography.size.base },
  stageButton: { minHeight: 48 }, taskList: { gap: Spacing.base },
  task: { borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, paddingTop: Spacing.md, gap: Spacing.md },
  pill: { borderWidth: 1, borderRadius: Radius.pill, paddingVertical: Spacing.xs, paddingHorizontal: Spacing.sm, alignSelf: 'flex-start', maxWidth: '100%' },
  pillText: { fontSize: Typography.size.xs, fontWeight: Typography.weight.bold, lineHeight: 18, includeFontPadding: false },
  nicheRail: { minHeight: 96 }, railContent: { gap: Spacing.sm, paddingVertical: Spacing.xs },
  nicheChip: { minWidth: 160, minHeight: 80, padding: Spacing.md, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.surfaceBorder, backgroundColor: Colors.surface, justifyContent: 'center', gap: Spacing.xs },
  selectedChip: { borderColor: Colors.primary, backgroundColor: Colors.primaryDim },
  chipTitle: { fontSize: Typography.size.base, color: Colors.textPrimary, fontWeight: Typography.weight.semibold },
  link: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm, paddingVertical: Spacing.sm },
  linkText: { color: Colors.primary, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, flexShrink: 1 },
  warning: { padding: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.warningDim, fontSize: Typography.size.base, lineHeight: 26, color: Colors.warning },
  risk: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, padding: Spacing.base, backgroundColor: Colors.surface, borderRadius: Radius.md },
  errorBox: { padding: Spacing.base, gap: Spacing.md, borderRadius: Radius.md, backgroundColor: Colors.dangerDim, borderWidth: 1, borderColor: Colors.danger },
  error: { color: Colors.danger, fontSize: Typography.size.base, lineHeight: 26 },
  footer: { color: Colors.textSecondary, textAlign: 'center', fontSize: Typography.size.sm, lineHeight: 21, paddingVertical: Spacing.base },
  pressed: { opacity: 0.75 },
});
