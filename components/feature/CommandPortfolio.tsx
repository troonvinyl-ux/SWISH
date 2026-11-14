import { memo, useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useCommandCentre, type CommandAction } from '@/hooks/useCommandCentre';
import { useCommandReportLayout } from '@/hooks/useCommandReportLayout';
import { NICHE_MODULES, NICHES, PRODUCTION_NICHE_IDS, type ProductionNicheId } from '@/constants/niches';
import { Colors, Spacing, Typography, CommandTheme } from '@/constants/theme';
import { formatCommandMoney, type CommandModule, type RecordedHealth } from '@/services/commandCentreService';
import { commandPriorityRows, formatCommandCount, formatCommandDuration, type CommandOperationalRow, type CommandPriorityKey } from '@/services/commandReportService';

interface SignalProps {label:string;status:RecordedHealth}
export const RecordedSignal=memo(function RecordedSignal({label,status}:SignalProps){return <Text style={s.note}>{label} · {status.replace(/_/g,' ')}</Text>;});
interface MetricProps {label:string;value:string|number|null|undefined;tone?:'ready'|'sales'}
export const CommandMetric=memo(function CommandMetric({label,value,tone}:MetricProps){return <View style={s.metric}><Text style={[s.figure,tone==='ready'?s.ready:tone==='sales'?s.sales:null]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{value??'—'}</Text><Text style={s.metricLabel} numberOfLines={1}>{label}</Text></View>;});
interface TableRowProps {id:ProductionNicheId;row?:CommandModule;operation?:CommandOperationalRow;tableWidth:number;nicheWidth:number;disabled:boolean;open:(id:ProductionNicheId,action?:CommandAction)=>void}
const NicheRow=memo(function NicheRow({id,row,operation,tableWidth,nicheWidth,disabled,open}:TableRowProps){
 const numberWidth=Math.max(1,(tableWidth-nicheWidth)/7);
 return <Pressable accessibilityRole="button" accessibilityLabel={`Open ${NICHE_MODULES[id].name} workspace, ${row?.inventory??'unavailable'} unique items`} disabled={disabled} onPress={()=>open(id,'open')} style={({pressed})=>[s.tableRow,pressed||disabled?s.pressed:null]}>
  <Text style={[s.niche,{width:nicheWidth}]} numberOfLines={1}>{NICHES[id].shortName}</Text>
  <Text style={[s.number,{width:numberWidth}]}>{formatCommandCount(row?.inventory)}</Text>
  <Text style={[s.number,{width:numberWidth}]}>{formatCommandCount(row?.stock_total)}</Text>
  <Text style={[s.number,{width:numberWidth}]}>{formatCommandCount(row?.drafts)}</Text>
  <Text style={[s.number,{width:numberWidth}]}>{formatCommandCount(row?.live)}</Text>
  <Text style={[s.number,{width:numberWidth}]}>{formatCommandCount(row?.sold_total)}</Text>
  <Text style={[s.number,{width:numberWidth},operation?.ready?s.ready:null]}>{formatCommandCount(operation?.ready)}</Text>
  <Text style={[s.number,{width:numberWidth},operation?.issues?s.attention:null]}>{formatCommandCount(operation?.issues)}</Text>
 </Pressable>;
});
interface PerformanceRow {label:string;value:string}
interface CommandPortfolioProps {platform?:boolean;enabled?:boolean;compact?:boolean;inspect?:(id:ProductionNicheId)=>void}
export function CommandPortfolio({platform,enabled,compact=false,inspect}:CommandPortfolioProps){
 const state=useCommandCentre(platform,enabled),layout=useCommandReportLayout();
 const [expanded,setExpanded]=useState<CommandPriorityKey|null>(null),[showDetails,setShowDetails]=useState(false);
 const ids=useMemo(()=>state.platform?PRODUCTION_NICHE_IDS:state.shell.modules.map(module=>module.id),[state.platform,state.shell.modules]);
 const modules=useMemo(()=>new Map(state.modules.map(row=>[row.id,row])),[state.modules]);
 const operations=useMemo(()=>new Map(state.operations?.niches.map(row=>[row.id,row])??[]),[state.operations]);
 const priorities=useMemo(()=>commandPriorityRows(state.operations),[state.operations]);
 const t=state.totals,o=state.operations,p=o?.performance,currencies=state.snapshot?.currencies??[];
 const money=useCallback((value:number|null|undefined)=>formatCommandMoney(value,currencies),[currencies]);
 const refresh=useCallback(()=>{void state.refresh();},[state.refresh]);
 const open=useCallback((id:ProductionNicheId,action:CommandAction='open')=>{void state.open(id,action);},[state.open]);
 const performance:PerformanceRow[]=[
  {label:'Sales · today',value:money(o?.totals.salesToday)},
  {label:'Sales · this week',value:money(t?.weekly)},
  {label:'Sales · this month',value:money(t?.monthly)},
  {label:'Live asking value',value:money(t?.listed)},
  {label:'Outstanding orders',value:formatCommandCount(t?.outstanding)},
  {label:'Ready, unpublished',value:formatCommandCount(o?.totals.ready)},
  {label:'Publication success',value:p?.publicationSuccessPct==null?'—':`${p.publicationSuccessPct.toFixed(1)}%`},
  {label:'Capture → live · avg',value:formatCommandDuration(p?.averageCaptureToLiveMs)},
 ];
 const summary=<View style={s.summary}>
  <View style={s.heading}><View style={s.flex}><Text style={s.kicker}>SWISH / {state.canViewPlatform?'OWNER OPERATIONS':'PORTFOLIO'}</Text><Text style={s.title}>{state.canViewPlatform?'Minority Report':'Resale report'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Refresh Minority Report" disabled={state.loading} onPress={refresh} style={({pressed})=>[s.icon,pressed||state.loading?s.pressed:null]}>{state.loading?<ActivityIndicator size="small" color={Colors.primary}/>:<MaterialIcons name="refresh" size={20} color={Colors.textSecondary}/>}</Pressable></View>
  {state.canViewPlatform?<View accessibilityLabel="Report workspace scope" style={s.scopeBar}><Pressable accessibilityRole="button" accessibilityState={{selected:state.reportScope==='workspace'}} onPress={()=>state.setReportScope('workspace')} style={({pressed})=>[s.scopeChip,state.reportScope==='workspace'?s.selectedScope:null,pressed?s.pressed:null]}><Text style={s.scopeText}>My workspace</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{selected:state.reportScope==='platform'}} onPress={()=>state.setReportScope('platform')} style={({pressed})=>[s.scopeChip,state.reportScope==='platform'?s.selectedScope:null,pressed?s.pressed:null]}><Text style={s.scopeText}>All workspaces</Text></Pressable></View>:null}
  <Text selectable style={s.scopeLabel}>{state.scopeLabel}</Text>
  {state.platform?<Text style={s.attention}>Platform record totals are not one seller’s inventory. The same eBay listing recorded in different workspaces counts in each workspace.</Text>:null}
  <Text style={[s.note,state.stale?s.attention:null]}>{state.snapshot?`${state.stale?(state.loading?'CACHED · refreshing':'CACHED · refresh failed'):'CURRENT · recorded data'} · ${new Date(state.snapshot.checkedAt).toLocaleString('en-GB')}`:state.loading?'Loading consolidated snapshot…':'Snapshot unavailable'}</Text>
  <View style={s.summaryMetrics}>
   <CommandMetric label="Unique items" value={formatCommandCount(t?.inventory)}/><CommandMetric label="Stock" value={formatCommandCount(t?.stock)}/><CommandMetric label="Draft listings" value={formatCommandCount(t?.drafts)}/><CommandMetric label="Live eBay listings" value={formatCommandCount(t?.live)}/>
   <CommandMetric label="Sold" value={formatCommandCount(t?.sold)}/><CommandMetric label="Sales · total" value={money(t?.realised)} tone="sales"/><CommandMetric label="Ready" value={formatCommandCount(o?.totals.ready)} tone={o?.totals.ready?'ready':undefined}/><CommandMetric label="Issues" value={formatCommandCount(o?.totals.issues)}/>
  </View>
  {state.error?<View accessibilityRole="alert" style={s.notice}><MaterialIcons name="error-outline" size={16} color={Colors.warning}/><Text style={s.noticeText}>{state.error} {state.stale?'Figures above are from the timestamped cached snapshot.':'No numbers inferred.'}</Text></View>:null}
  {state.shell.moduleError?<Text accessibilityRole="alert" style={s.attention}>{state.shell.moduleError}</Text>:null}
 </View>;
 const numberWidth=Math.max(1,(layout.tableWidth-layout.nicheWidth)/7);
 const table=<View style={[s.tableBlock,layout.wide?{width:layout.tableWidth}:null]}>
  <View style={s.sectionHead}><Text style={s.sectionTitle}>Niche ledger</Text><Text style={s.note}>Tap row to open</Text></View>
  {state.platform?<Text style={s.note}>Rows aggregate all workspaces; tapping opens that niche in your current workspace only.</Text>:null}
  <View style={{height:CommandTheme.tableHeaderHeight+ids.length*CommandTheme.rowHeight}}>
   <ScrollView horizontal showsHorizontalScrollIndicator={!layout.wide} contentContainerStyle={{width:layout.tableWidth}}>
    <FlatList scrollEnabled={false} style={{width:layout.tableWidth}} data={ids} keyExtractor={id=>id}
     ListHeaderComponent={<View style={s.tableHeader}><Text style={[s.columnLabel,{width:layout.nicheWidth,textAlign:'left'}]}>Niche</Text><Text style={[s.columnLabel,{width:numberWidth}]}>Unique</Text><Text style={[s.columnLabel,{width:numberWidth}]}>Stock</Text><Text style={[s.columnLabel,{width:numberWidth}]}>Draft</Text><Text style={[s.columnLabel,{width:numberWidth}]}>Live</Text><Text style={[s.columnLabel,{width:numberWidth}]}>Sold</Text><Text style={[s.columnLabel,{width:numberWidth}]}>Ready</Text><Text style={[s.columnLabel,{width:numberWidth}]}>Issues</Text></View>}
     renderItem={({item:id})=><NicheRow id={id} row={modules.get(id)} operation={operations.get(id)} tableWidth={layout.tableWidth} nicheWidth={layout.nicheWidth} disabled={state.shell.moduleLoading||(state.loading&&!state.snapshot)} open={open}/>}/>
   </ScrollView>
  </View>
  {!layout.wide?<Text style={s.note}>Swipe table horizontally for Ready and Issues.</Text>:null}
  <Text style={s.note}>Unique items are retained through sale. Stock, drafts, listings and sold are separate metrics, not additive totals.</Text>
  <Text style={s.note}>Live inventory items: {formatCommandCount(t?.liveItems)} · live eBay listings: {formatCommandCount(t?.live)} · archived: {formatCommandCount(t?.archived)}. Drafts count items, not duplicate draft rows.</Text>
  <Text style={s.note}>Counts are saved SWISH records, not a live eBay account total. Refresh reads records; use the niche eBay Hub to reconcile marketplace changes.</Text>
  {state.platform&&state.snapshot?.unclassifiedInventory?<Text style={s.note}>{formatCommandCount(state.snapshot.unclassifiedInventory)} unclassified historical items included in the top inventory total; not assigned to a niche.</Text>:null}
  {!ids.length?<Text style={s.note}>No verified niche memberships returned. Refresh account access to open a workspace.</Text>:null}
 </View>;
 const side=<View style={s.side}>
  <View style={s.sectionHead}><Text style={s.sectionTitle}>Commercial performance</Text></View>
  <FlatList scrollEnabled={false} data={performance} keyExtractor={row=>row.label} renderItem={({item})=><View style={s.dataRow}><Text style={s.dataLabel}>{item.label}</Text><Text style={s.dataValue}>{item.value}</Text></View>}/>
  <Text style={s.note}>Sales = realised ledger proceeds. Asking value is not revenue or profit. Day / week / month: Europe/London; week starts Monday.</Text>
  <Text style={s.note}>Quick List · {p?.windowDays??30} days: {formatCommandCount(p?.confirmed)} confirmed / {formatCommandCount(p?.attempts)} completed attempts; {formatCommandCount(p?.durationSamples)} capture-time samples. Other publication workflows are not measured here.</Text>
  <View style={s.sectionHead}><Text style={s.sectionTitle}>Action priority</Text><Text style={s.note}>Items</Text></View>
  <FlatList scrollEnabled={false} data={priorities} keyExtractor={row=>row.key} renderItem={({item,index})=>{
   const selected=expanded===item.key;
   const affected=ids.filter(id=>{const count=operations.get(id)?.[item.key];return count===null||count===undefined||count>0;});
   return <View><Pressable accessibilityRole="button" accessibilityState={{expanded:selected}} accessibilityLabel={`${item.label}, ${item.count==null?'not assessed':item.count} items, show detail`} onPress={()=>setExpanded(selected?null:item.key)} style={({pressed})=>[s.priorityRow,pressed?s.pressed:null]}><Text style={s.rank}>{index+1}</Text><Text style={s.priorityLabel}>{item.label}</Text><Text style={[s.priorityCount,item.count&&item.key==='ready'?s.ready:null]}>{formatCommandCount(item.count)}</Text><MaterialIcons name={selected?'expand-less':'expand-more'} size={16} color={Colors.textTertiary}/></Pressable>
    {selected?<View style={s.expansion}><Text style={s.note}>{item.note}</Text><FlatList scrollEnabled={false} data={affected} keyExtractor={id=>id} renderItem={({item:id})=><Pressable accessibilityRole="button" disabled={state.shell.moduleLoading} onPress={()=>open(id,item.action)} style={({pressed})=>[s.detailLink,pressed?s.pressed:null]}><Text style={s.dataLabel}>{NICHES[id].shortName}</Text><Text style={s.dataValue}>{formatCommandCount(operations.get(id)?.[item.key])}</Text><MaterialIcons name="chevron-right" size={16} color={Colors.textSecondary}/></Pressable>} ListEmptyComponent={<Text style={s.note}>No affected canonical items recorded.</Text>}/></View>:null}
   </View>;
  }}/>
  <Text style={s.note}>Ready and missing specifics require current preflight evidence. {formatCommandCount(o?.totals.readinessAssessed)} checked / {formatCommandCount(o?.totals.unpublished)} unpublished items. — means unassessed, not zero. Issues count distinct affected items; categories can overlap.</Text>
 </View>;
 const body=<View style={[s.reportBody,layout.wide?s.wide:null]}>{table}{side}</View>;
 const detail=<View style={s.footer}><Pressable accessibilityRole="button" accessibilityState={{expanded:showDetails}} onPress={()=>setShowDetails(value=>!value)} style={({pressed})=>[s.detailLink,pressed?s.pressed:null]}><Text style={s.dataLabel}>{showDetails?'Hide operational detail':'Show operational detail'}</Text><MaterialIcons name={showDetails?'expand-less':'expand-more'} size={18} color={Colors.textSecondary}/></Pressable>
  {showDetails?<View style={s.expansion}><Text style={s.note}>{state.platform?'Owner-only consolidated platform read. Operational readiness/issues cover registered niches.':`Verified current workspace only. Workspace ID: ${state.workspaceId??'unavailable'}. No other workspace records are added.`} No marketplace operations run on refresh.</Text><Text style={s.note}>Recorded units: {formatCommandCount(t?.units)} · realised transactions: {formatCommandCount(t?.completedSales)} · omitted duplicate sales: {formatCommandCount(t?.duplicates)}</Text>
   {inspect?<FlatList scrollEnabled={false} data={ids} keyExtractor={id=>id} renderItem={({item:id})=><Pressable onPress={()=>inspect(id)} style={({pressed})=>[s.detailLink,pressed?s.pressed:null]}><Text style={s.dataLabel}>Inspect {NICHES[id].shortName}</Text><MaterialIcons name="chevron-right" size={16} color={Colors.textSecondary}/></Pressable>}/>:null}
   <FlatList scrollEnabled={false} data={state.snapshot?.activity??[]} keyExtractor={(row,index)=>`${row.created_at}:${index}`} renderItem={({item:row})=><Text style={s.note}>{row.function_name.replace('swish-','')} · {row.outcome} · HTTP {row.status_code} · {row.niche_id} · {new Date(row.created_at).toLocaleString('en-GB')}</Text>}/>
   <FlatList scrollEnabled={false} data={state.snapshot?.limitations??[]} keyExtractor={note=>note} renderItem={({item})=><Text style={s.note}>{item}</Text>}/>
  </View>:null}
 </View>;
 if(compact)return <View style={s.content}>{summary}{body}{detail}</View>;
 return <FlatList data={['report']} keyExtractor={item=>item} renderItem={()=>body} ListHeaderComponent={summary} ListFooterComponent={detail} style={s.page} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} refreshing={state.loading} onRefresh={refresh}/>;
}
const s=StyleSheet.create({
 page:{flex:1,backgroundColor:Colors.background},content:{width:'100%',maxWidth:CommandTheme.maxWidth,alignSelf:'center',paddingHorizontal:Spacing.base,paddingBottom:Spacing.base},
 summary:{paddingBottom:Spacing.md,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:Colors.surfaceBorder},heading:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},flex:{flex:1},
 kicker:{fontSize:Typography.size.xs,color:Colors.textTertiary,fontWeight:Typography.weight.semibold,letterSpacing:1,includeFontPadding:false},title:{fontSize:Typography.size.lg,color:Colors.textPrimary,fontWeight:Typography.weight.bold,includeFontPadding:false},
 scopeBar:{flexDirection:'row',flexWrap:'wrap',gap:Spacing.sm,paddingVertical:Spacing.sm},scopeChip:{minHeight:CommandTheme.rowHeight,paddingHorizontal:Spacing.base,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:Colors.surfaceBorder,backgroundColor:Colors.surface,borderRadius:Spacing.sm},selectedScope:{borderColor:Colors.primary,backgroundColor:Colors.primaryDim},scopeText:{fontSize:Typography.size.base,color:Colors.textPrimary,fontWeight:Typography.weight.semibold,includeFontPadding:false},scopeLabel:{fontSize:Typography.size.base,lineHeight:26,color:Colors.primary,includeFontPadding:false},
 icon:{width:CommandTheme.rowHeight,height:CommandTheme.rowHeight,alignItems:'center',justifyContent:'center'},summaryMetrics:{flexDirection:'row',flexWrap:'wrap',paddingTop:Spacing.sm},metric:{width:'25%',paddingVertical:Spacing.sm,paddingRight:Spacing.xs},
 figure:{fontSize:Typography.size.md,lineHeight:Typography.size.xl,color:Colors.textPrimary,fontWeight:Typography.weight.semibold,fontVariant:['tabular-nums'],includeFontPadding:false},metricLabel:{fontSize:Typography.size.sm,lineHeight:CommandTheme.numericLineHeight,color:Colors.textSecondary,includeFontPadding:false},
 note:{fontSize:Typography.size.sm,lineHeight:CommandTheme.numericLineHeight,color:Colors.textTertiary,includeFontPadding:false,flexShrink:1},notice:{flexDirection:'row',gap:Spacing.sm,paddingVertical:Spacing.sm},noticeText:{flex:1,color:Colors.warning,fontSize:Typography.size.sm,lineHeight:CommandTheme.numericLineHeight},
 reportBody:{gap:Spacing.base,paddingTop:Spacing.sm},wide:{flexDirection:'row',alignItems:'flex-start'},tableBlock:{gap:Spacing.sm},side:{flex:1,minWidth:0,gap:Spacing.xs},sectionHead:{minHeight:CommandTheme.tableHeaderHeight,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:Spacing.sm,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:Colors.surfaceBorder},sectionTitle:{color:Colors.textPrimary,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,includeFontPadding:false},
 tableHeader:{height:CommandTheme.tableHeaderHeight,flexDirection:'row',alignItems:'center',backgroundColor:Colors.surface},columnLabel:{fontSize:Typography.size.sm,color:Colors.textSecondary,fontWeight:Typography.weight.medium,textAlign:'right',paddingHorizontal:Spacing.sm,includeFontPadding:false},
 tableRow:{height:CommandTheme.rowHeight,flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:Colors.surfaceBorder},niche:{paddingHorizontal:Spacing.sm,fontSize:Typography.size.sm,color:Colors.textPrimary,fontWeight:Typography.weight.medium,includeFontPadding:false},number:{fontSize:CommandTheme.numericFontSize,color:Colors.textPrimary,textAlign:'right',paddingHorizontal:Spacing.sm,fontVariant:['tabular-nums'],includeFontPadding:false},
 dataRow:{minHeight:CommandTheme.dataRowHeight,flexDirection:'row',alignItems:'center',gap:Spacing.sm,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:Colors.surfaceBorder},dataLabel:{flex:1,fontSize:Typography.size.sm,lineHeight:CommandTheme.numericLineHeight,color:Colors.textSecondary,includeFontPadding:false},dataValue:{fontSize:Typography.size.sm,lineHeight:CommandTheme.numericLineHeight,fontWeight:Typography.weight.medium,color:Colors.textPrimary,textAlign:'right',fontVariant:['tabular-nums'],includeFontPadding:false},
 priorityRow:{minHeight:CommandTheme.rowHeight,flexDirection:'row',alignItems:'center',gap:Spacing.sm,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:Colors.surfaceBorder},rank:{width:Spacing.base,color:Colors.textTertiary,fontSize:Typography.size.xs,textAlign:'center'},priorityLabel:{flex:1,fontSize:Typography.size.sm,color:Colors.textPrimary,lineHeight:CommandTheme.numericLineHeight},priorityCount:{minWidth:Spacing.xl,fontSize:Typography.size.sm,color:Colors.textPrimary,textAlign:'right',fontVariant:['tabular-nums']},
 expansion:{paddingHorizontal:Spacing.sm,paddingVertical:Spacing.sm,gap:Spacing.sm,backgroundColor:Colors.surface},detailLink:{minHeight:CommandTheme.rowHeight,flexDirection:'row',alignItems:'center',gap:Spacing.sm,borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:Colors.surfaceBorder},footer:{marginTop:Spacing.md},
 ready:{color:Colors.primary},sales:{color:Colors.success},attention:{color:Colors.warning,fontSize:Typography.size.sm,lineHeight:CommandTheme.numericLineHeight},pressed:{opacity:0.65,backgroundColor:Colors.surfaceHighlight},
});
