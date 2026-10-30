import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { AuthRouter, getSupabaseClient, useAuth } from '@/template';
import { MaterialIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { PRODUCTION_NICHES, getNicheSpecialistIds, type NicheConfig } from '@/constants/niches';

const C = { bg:'#080B10', panel:'#0D131B', line:'#20303D', text:'#E9F0F5', muted:'#7F929F', faint:'#536571', amber:'#F3C66B', cyan:'#72D7E5', green:'#79D6A4', red:'#F18C83', blue:'#8EB8FF' };
type ItemRow = { id:string; specialist_id:string|null; status:string|null; valuation_mid:number|null; expected_selling_price:number|null; acquired_cost:number|null; sold_price:number|null; sold_at:string|null };
type ListingRow = { id:string; item_id:string|null; status:string|null; price:number|null; published_at:string|null; items?:{specialist_id?:string|null}|null };
type SaleRow = { sale_price:number|null; net_revenue:number|null; profit:number|null; sold_at:string|null; items?:{specialist_id?:string|null}|null };
type NicheMetric = { niche:NicheConfig; stock:number; active:number; drafts:number; unlisted:number; soldMonth:number; salesMonth:number; activeValue:number; potential:number };

function money(v:number){ return new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP',maximumFractionDigits:0}).format(Number.isFinite(v)?v:0); }
function compactMoney(v:number){ if(v>=1000000)return '£'+(v/1000000).toFixed(1)+'m'; if(v>=10000)return '£'+(v/1000).toFixed(1)+'k'; return money(v); }
function inMonth(date:string|null|undefined,start:number){ if(!date)return false; const t=new Date(date).getTime(); return Number.isFinite(t)&&t>=start; }

function MasterDashboard(){
  const {user}=useAuth();
  const {tenant,tenantLoading,tenantError,reloadTenant}=useApp();
  const insets=useSafeAreaInsets();
  const {width}=useWindowDimensions();
  const landscape=width>=720;
  const [items,setItems]=useState<ItemRow[]>([]);
  const [listings,setListings]=useState<ListingRow[]>([]);
  const [sales,setSales]=useState<SaleRow[]>([]);
  const [connector,setConnector]=useState<{status?:string;last_sync_at?:string|null}|null>(null);
  const [loading,setLoading]=useState(true);
  const [refreshing,setRefreshing]=useState(false);
  const [dataIssue,setDataIssue]=useState<string|null>(null);
  const [updatedAt,setUpdatedAt]=useState<Date|null>(null);

  const load=useCallback(async()=>{
    if(!tenant?.id){setLoading(false);return;}
    const db=getSupabaseClient();
    const [ir,lr,sr,cr]=await Promise.all([
      db.from('items').select('id,specialist_id,status,valuation_mid,expected_selling_price,acquired_cost,sold_price,sold_at').eq('tenant_id',tenant.id).limit(5000),
      db.from('listings').select('id,item_id,status,price,published_at,items!inner(specialist_id)').eq('tenant_id',tenant.id).eq('marketplace_id','ebay').limit(5000),
      db.from('sales').select('sale_price,net_revenue,profit,sold_at,items(specialist_id)').eq('tenant_id',tenant.id).eq('marketplace_id','ebay').limit(5000),
      db.from('marketplace_connectors').select('status,last_sync_at').eq('tenant_id',tenant.id).eq('marketplace_id','ebay').maybeSingle()
    ]);
    const errors=[ir.error,lr.error,sr.error].filter(Boolean);
    setDataIssue(errors.length?'Some live metrics could not be loaded. Pull down to retry.':null);
    setItems((ir.data??[]) as ItemRow[]);
    setListings((lr.data??[]) as unknown as ListingRow[]);
    setSales((sr.data??[]) as unknown as SaleRow[]);
    setConnector(cr.data??null);
    setUpdatedAt(new Date());
    setLoading(false);
    setRefreshing(false);
  },[tenant?.id]);

  useEffect(()=>{void load();},[load]);
  const refresh=useCallback(()=>{setRefreshing(true);void load();},[load]);
  const monthStart=useMemo(()=>new Date(new Date().getFullYear(),new Date().getMonth(),1).getTime(),[]);

  const nicheMetrics=useMemo<NicheMetric[]>(()=>PRODUCTION_NICHES.map(niche=>{
    const ids=getNicheSpecialistIds(niche.id);
    const ni=items.filter(i=>!!i.specialist_id&&ids.includes(i.specialist_id));
    const nl=listings.filter(l=>!!l.items?.specialist_id&&ids.includes(l.items.specialist_id));
    const ns=sales.filter(s=>!!s.items?.specialist_id&&ids.includes(s.items.specialist_id));
    const activeRows=nl.filter(l=>l.status==='active');
    const draftRows=nl.filter(l=>l.status==='draft'||l.status==='pending');
    const monthRows=ns.filter(s=>inMonth(s.sold_at,monthStart));
    const activeIds=new Set(activeRows.map(l=>l.item_id).filter(Boolean));
    const eligible=ni.filter(i=>!['sold','archived','deleted'].includes((i.status??'').toLowerCase()));
    const unlisted=eligible.filter(i=>!activeIds.has(i.id));
    const potential=unlisted.reduce((sum,i)=>sum+Number(i.expected_selling_price??i.valuation_mid??0),0);
    return {niche,stock:ni.length,active:activeRows.length,drafts:draftRows.length,unlisted:unlisted.length,soldMonth:monthRows.length,
      salesMonth:monthRows.reduce((sum,s)=>sum+Number(s.sale_price??0),0),
      activeValue:activeRows.reduce((sum,l)=>sum+Number(l.price??0),0),potential};
  }),[items,listings,sales,monthStart]);

  const totals=useMemo(()=>({
    stock:nicheMetrics.reduce((s,n)=>s+n.stock,0),
    active:nicheMetrics.reduce((s,n)=>s+n.active,0),
    drafts:nicheMetrics.reduce((s,n)=>s+n.drafts,0),
    salesMonth:nicheMetrics.reduce((s,n)=>s+n.salesMonth,0),
    soldMonth:nicheMetrics.reduce((s,n)=>s+n.soldMonth,0),
    activeValue:nicheMetrics.reduce((s,n)=>s+n.activeValue,0),
    potential:nicheMetrics.reduce((s,n)=>s+n.potential,0)
  }),[nicheMetrics]);

  const tasks=useMemo(()=>{
    const r:{key:string;title:string;detail:string;count:number;tone:string}[]=[];
    if(dataIssue)r.push({key:'data',title:'Dashboard data needs attention',detail:dataIssue,count:1,tone:C.red});
    const drafts=nicheMetrics.reduce((s,n)=>s+n.drafts,0);
    if(drafts)r.push({key:'drafts',title:'Listings waiting to go live',detail:'Review drafts and confirm category-specific item specifics before publishing.',count:drafts,tone:C.amber});
    const unlisted=nicheMetrics.reduce((s,n)=>s+n.unlisted,0);
    if(unlisted)r.push({key:'unlisted',title:'Inventory to review for listing',detail:'Stock not currently represented by an active eBay listing. Some items may be sold, archived or intentionally held.',count:unlisted,tone:C.cyan});
    if(connector?.status!=='connected')r.push({key:'connector',title:'Check eBay connection',detail:'The shared marketplace connector is not reporting a connected state.',count:1,tone:C.red});
    else if(!connector.last_sync_at||Date.now()-new Date(connector.last_sync_at).getTime()>86400000)r.push({key:'sync',title:'Check marketplace sync',detail:'The last recorded sync is over 24 hours old, or no successful sync timestamp is recorded.',count:1,tone:C.amber});
    if(!r.length)r.push({key:'clear',title:'No urgent signals detected',detail:'Continue monitoring synchronisation, drafts and stock ready to list.',count:0,tone:C.green});
    return r.slice(0,6);
  },[dataIssue,nicheMetrics,connector]);

  if(!isSwishMasterAdmin(user?.email))return <View style={[s.screen,s.center]}><MaterialIcons name="lock" size={32} color={C.red}/><Text style={s.accessTitle}>Master account only</Text><Text style={s.muted}>This private dashboard is restricted to the SWISH owner account.</Text></View>;

  const nichePanel=<Panel title="01 / PORTFOLIO" subtitle="Niche performance at a glance" icon="grid-view">
    <View style={s.nicheGrid}>{nicheMetrics.map(m=><View key={m.niche.id} style={s.nicheCard}>
      <View style={[s.nicheDot,{backgroundColor:m.niche.color}]}/>
      <View style={s.nicheMain}><Text style={s.nicheName} numberOfLines={1}>{m.niche.shortName}</Text><Text style={s.nicheMeta}>{m.stock} stock · {m.active} live</Text></View>
      <View style={s.nicheRight}><Text style={[s.nicheMoney,{color:m.salesMonth>0?C.green:C.text}]}>{compactMoney(m.salesMonth)}</Text><Text style={s.nicheCaption}>THIS MONTH</Text></View>
    </View>)}</View>
    <View style={s.panelFoot}><Text style={s.small}> {totals.stock.toLocaleString('en-GB')} stock records · {totals.active.toLocaleString('en-GB')} active listings</Text></View>
  </Panel>;

  const taskPanel=<Panel title="02 / MISSION CONTROL" subtitle="Outstanding work & signals" icon="track-changes">
    {tasks.map(t=><View key={t.key} style={s.taskRow}><View style={[s.taskMarker,{backgroundColor:t.tone}]}/><View style={s.taskBody}><Text style={s.taskTitle}>{t.title}</Text><Text style={s.taskDetail}>{t.detail}</Text></View>{t.count>0?<View style={[s.countPill,{borderColor:t.tone+'77'}]}><Text style={[s.countText,{color:t.tone}]}>{t.count}</Text></View>:null}</View>)}
    <View style={s.panelFoot}><Text style={s.small}>Signals are derived from current records, not invented tasks.</Text></View>
  </Panel>;

  const moneyPanel=<Panel title="03 / CAPITAL & POTENTIAL" subtitle="Recorded results vs estimated pipeline" icon="show-chart">
    <View style={s.moneyHero}><Text style={s.moneyLabel}>RECORDED SALES · THIS MONTH</Text><Text style={s.moneyValue}>{money(totals.salesMonth)}</Text><Text style={s.moneySub}>{totals.soldMonth} sale records this month</Text></View>
    <View style={s.moneyGrid}>
      <Metric label="LIVE ASKING VALUE" value={compactMoney(totals.activeValue)} tone={C.cyan} note="Not guaranteed revenue"/>
      <Metric label="UNLISTED POTENTIAL" value={compactMoney(totals.potential)} tone={C.amber} note="Valuation / asking estimate"/>
      <Metric label="DRAFT LISTINGS" value={totals.drafts.toLocaleString('en-GB')} tone={C.blue} note="Awaiting review"/>
      <Metric label="EST. PROFIT" value="—" tone={C.muted} note="Fee and cost data not reconciled"/>
    </View>
    <View style={s.panelFoot}><Text style={s.small}>Sales ≠ profit ≠ eBay payout. Figures reflect available SWISH records.</Text></View>
  </Panel>;

  return <View style={[s.screen,{paddingTop:Math.max(insets.top,8),paddingBottom:Math.max(insets.bottom,8)]}>
    <View style={s.topBar}>
      <View style={s.brandMark}><MaterialIcons name="radar" size={23} color={C.amber}/></View>
      <View style={s.brandCopy}><Text style={s.eyebrow}>SWISH / PRIVATE OPERATIONS</Text><Text style={s.brandTitle}>MASTER DASHBOARD</Text></View>
      <View style={s.liveState}><View style={[s.liveDot,{backgroundColor:loading?C.amber:dataIssue?C.red:C.green}]}/><Text style={s.liveText}>{loading?'CONNECTING':dataIssue?'PARTIAL DATA':'CONNECTED'}</Text></View>
      <Pressable onPress={refresh} style={s.refresh} accessibilityLabel="Refresh dashboard"><MaterialIcons name="refresh" size={20} color={C.text}/></Pressable>
    </View>
    <View style={s.commandStrip}><Text style={s.commandLabel}>PORTFOLIO SIGNAL</Text><Text style={s.commandValue}>{loading?'Synchronising live records…':totals.active+' live · '+totals.drafts+' drafts · '+money(totals.salesMonth)+' sold this month'}</Text>{updatedAt?<Text style={s.updated}>UPDATED {updatedAt.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</Text>:null}</View>
    {tenantLoading||loading?<View style={s.loading}><ActivityIndicator color={C.amber} size="large"/><Text style={s.muted}>Loading your private operations data…</Text></View>
    :tenantError?<View style={s.loading}><Text style={s.accessTitle}>Could not load business account</Text><Text style={s.muted}>{tenantError}</Text><Pressable onPress={()=>{void reloadTenant();void load();}} style={s.actionButton}><Text style={s.actionText}>Retry</Text></Pressable></View>
    :<ScrollView style={s.scroll} contentContainerStyle={[s.panels,landscape&&s.panelsLandscape]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={C.amber}/>} showsVerticalScrollIndicator={false}>
      <View style={[s.panelWrap,landscape&&s.panelWrapLandscape]}>{nichePanel}</View>
      <View style={[s.panelWrap,landscape&&s.panelWrapLandscape]}>{taskPanel}</View>
      <View style={[s.panelWrap,landscape&&s.panelWrapLandscape]}>{moneyPanel}</View>
    </ScrollView>}
    <View style={s.bottomBar}><Text style={s.bottomBrand}>SWISH INTELLIGENCE ENGINE</Text><Text style={s.bottomNote}>OWNER ACCESS · PRIVATE INSTANCE</Text></View>
  </View>;
}

function Panel({title,subtitle,icon,children}:{title:string;subtitle:string;icon:string;children:React.ReactNode}){
  return <View style={s.panel}><View style={s.panelHeader}><View style={s.panelIcon}><MaterialIcons name={icon as any} size={17} color={C.cyan}/></View><View style={s.panelTitleBlock}><Text style={s.panelTitle}>{title}</Text><Text style={s.panelSubtitle}>{subtitle}</Text></View><View style={s.panelRule}/></View>{children}</View>;
}
function Metric({label,value,tone,note}:{label:string;value:string;tone:string;note:string}){
  return <View style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={[s.metricValue,{color:tone}]}>{value}</Text><Text style={s.metricNote}>{note}</Text></View>;
}

const s=StyleSheet.create({
  screen:{flex:1,backgroundColor:C.bg},center:{alignItems:'center',justifyContent:'center',padding:28,gap:12},
  topBar:{flexDirection:'row',alignItems:'center',paddingHorizontal:15,paddingVertical:9,gap:10,borderBottomWidth:1,borderBottomColor:C.line},
  brandMark:{width:36,height:36,alignItems:'center',justifyContent:'center',borderRadius:10,borderWidth:1,borderColor:C.amber+'77',backgroundColor:'#17202A'},
  brandCopy:{flex:1,gap:2},eyebrow:{fontSize:9,letterSpacing:2,fontWeight:'700',color:C.cyan},brandTitle:{fontSize:17,fontWeight:'800',letterSpacing:1.1,color:C.text},
  liveState:{flexDirection:'row',alignItems:'center',gap:5,borderWidth:1,borderColor:C.line,paddingHorizontal:8,paddingVertical:5,borderRadius:30},
  liveDot:{width:6,height:6,borderRadius:3},liveText:{color:C.muted,fontSize:8,letterSpacing:0.8,fontWeight:'700'},
  refresh:{width:36,height:36,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line,borderRadius:10,backgroundColor:C.panel},
  commandStrip:{paddingHorizontal:16,paddingVertical:10,backgroundColor:'#0A1118',borderBottomWidth:1,borderBottomColor:C.line,gap:3},
  commandLabel:{color:C.amber,fontSize:8,fontWeight:'800',letterSpacing:1.7},commandValue:{color:C.text,fontSize:12,fontWeight:'600'},updated:{color:C.faint,fontSize:8,letterSpacing:1,marginTop:1},
  loading:{flex:1,alignItems:'center',justifyContent:'center',gap:12,padding:24},scroll:{flex:1},panels:{padding:10,gap:10},panelsLandscape:{flexDirection:'row',alignItems:'stretch',padding:9,gap:9},
  panelWrap:{width:'100%'},panelWrapLandscape:{flex:1,width:undefined,minWidth:0},
  panel:{flex:1,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:13,padding:12,gap:12},
  panelHeader:{flexDirection:'row',alignItems:'center',gap:8},panelIcon:{width:29,height:29,borderRadius:8,backgroundColor:'#15232D',alignItems:'center',justifyContent:'center'},
  panelTitleBlock:{gap:3,flexShrink:1},panelTitle:{color:C.text,fontSize:10,fontWeight:'800',letterSpacing:0.8},panelSubtitle:{color:C.muted,fontSize:9},panelRule:{flex:1,height:1,backgroundColor:C.line,marginLeft:4},
  nicheGrid:{gap:6},nicheCard:{flexDirection:'row',alignItems:'center',gap:8,paddingVertical:7,paddingHorizontal:7,borderRadius:8,borderWidth:1,borderColor:'#1A2731',backgroundColor:'#0A1017'},
  nicheDot:{width:7,height:7,borderRadius:4},nicheMain:{flex:1,minWidth:0,gap:2},nicheName:{color:C.text,fontSize:11,fontWeight:'700'},nicheMeta:{color:C.muted,fontSize:9},
  nicheRight:{alignItems:'flex-end',gap:2},nicheMoney:{fontSize:10,fontWeight:'800'},nicheCaption:{color:C.faint,fontSize:7,letterSpacing:0.7},
  panelFoot:{paddingTop:8,borderTopWidth:1,borderTopColor:C.line},small:{color:C.faint,fontSize:9,lineHeight:14},
  taskRow:{flexDirection:'row',alignItems:'flex-start',gap:8,paddingVertical:9,borderBottomWidth:1,borderBottomColor:'#1A2731'},
  taskMarker:{width:6,height:6,borderRadius:3,marginTop:4},taskBody:{flex:1,gap:4},taskTitle:{color:C.text,fontSize:11,fontWeight:'700',lineHeight:15},taskDetail:{color:C.muted,fontSize:9,lineHeight:14},
  countPill:{minWidth:24,height:24,borderRadius:7,borderWidth:1,alignItems:'center',justifyContent:'center',paddingHorizontal:5},countText:{fontSize:10,fontWeight:'800'},
  moneyHero:{padding:13,borderRadius:10,backgroundColor:'#111D23',borderWidth:1,borderColor:'#27414A',gap:4},moneyLabel:{color:C.cyan,fontSize:8,letterSpacing:1.3,fontWeight:'800'},
  moneyValue:{color:C.text,fontSize:27,fontWeight:'800',letterSpacing:-0.7},moneySub:{color:C.muted,fontSize:9},moneyGrid:{flexDirection:'row',flexWrap:'wrap',gap:7},
  metric:{width:'47%',flexGrow:1,minWidth:88,padding:9,borderRadius:9,borderWidth:1,borderColor:'#1A2731',backgroundColor:'#0A1017',gap:5},
  metricLabel:{color:C.faint,fontSize:7,letterSpacing:0.8,fontWeight:'800'},metricValue:{fontSize:17,fontWeight:'800'},metricNote:{color:C.muted,fontSize:8,lineHeight:12},
  actionButton:{backgroundColor:C.amber,borderRadius:8,paddingHorizontal:16,paddingVertical:10},actionText:{color:C.bg,fontWeight:'800',fontSize:12},
  accessTitle:{color:C.text,fontSize:20,fontWeight:'800',textAlign:'center'},muted:{color:C.muted,fontSize:12,lineHeight:18,textAlign:'center'},
  bottomBar:{paddingHorizontal:15,paddingVertical:8,flexDirection:'row',justifyContent:'space-between',borderTopWidth:1,borderTopColor:C.line},
  bottomBrand:{color:C.faint,fontSize:7,letterSpacing:1.1,fontWeight:'800'},bottomNote:{color:C.faint,fontSize:7,letterSpacing:0.6}
});

export default function MasterDashboardRoute(){
  return <AuthRouter loginRoute="/login" excludeRoutes={[]}><MasterDashboard/></AuthRouter>;
}
