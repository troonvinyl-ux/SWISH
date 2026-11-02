import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { Picker } from '@react-native-picker/picker';
import { getSupabaseClient } from '@/template';
import { createManualListing, submitListingToMarketplace, endListing, deleteListing, updateListingTitle, updateListingPrice, type SavedListing } from '@/services/listingService';
import { getProductionNicheSpecialistIds } from '@/services/nicheRouting';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { PRODUCTION_NICHES } from '@/constants/niches';

type Item = { id:string; canonical_title:string; description?:string; expected_selling_price?:number; condition?:string; condition_notes?:string; media?:string[]; specialist_id:string; attributes?:Record<string,any>; quantity?:number; inventory_id?:string; status?:string };
type NicheId = (typeof PRODUCTION_NICHES)[number]['id'];
type Result = { create:'waiting'|'passed'|'failed'; revise:'waiting'|'passed'|'failed'; end:'waiting'|'passed'|'failed'; detail:string; at:string };
let clientInstance: ReturnType<typeof getSupabaseClient> | null = null;
function getClient() {
  if (clientInstance) return clientInstance;
  clientInstance = getSupabaseClient();
  return clientInstance;
}
const RESULTS_KEY = 'swish.testlab.niche-results.v2';
const OWNER_EMAIL = 'troonvinyl@gmail.com';

export default function TestLabHome() {
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [session,setSession]=useState<any>(null);
  const [tenant,setTenant]=useState<any>(null);
  const [tenants,setTenants]=useState<any[]>([]);
  const [niche,setNiche]=useState<string>('clothing');
  const [items,setItems]=useState<Item[]>([]);
  const [selected,setSelected]=useState<Item|null>(null);
  const [listing,setListing]=useState<SavedListing|null>(null);
  const [externalId,setExternalId]=useState('');
  const [testTitle,setTestTitle]=useState('');
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('Sign in with the SWISH owner account. Select a niche to load inventory within that niche boundary.');
  const [results,setResults]=useState<Record<string,Result>>({});
  const [events,setEvents]=useState<string[]>([]);

  const nicheConfig = useMemo(()=>PRODUCTION_NICHES.find(n=>n.id===niche),[niche]);
  const specialistIds = useMemo(()=>getProductionNicheSpecialistIds(niche),[niche]);

  const record = useCallback(async (event:string,detail='')=>{
    const row = new Date().toISOString()+' · '+event+(detail?' · '+detail:'');
    setEvents(prev=>[row,...prev].slice(0,60));
    const next:Result = {create:'waiting',revise:'waiting',end:'waiting',detail:event+(detail?' — '+detail:''),at:new Date().toISOString()};
    setResults(prev=>{const updated={...prev,[niche]:{...(prev[niche]??next),detail:next.detail,at:next.at}};void AsyncStorage.setItem(RESULTS_KEY,JSON.stringify(updated));return updated;});
  },[niche]);

  const loadTenants = useCallback(async()=>{
    const {data,error}=await getClient().from('tenants').select('id,name').order('created_at',{ascending:true});
    if(error){setMessage('Tenant access check failed: '+error.message);return;}
    const rows=data??[];
    setTenants(rows);
    setTenant(rows[0]??null);
    if(!rows.length)setMessage('The signed-in owner account has no tenant membership visible to the existing backend policies.');
  },[]);

  useEffect(()=>{
    let alive=true;
    (async()=>{
      const saved=await AsyncStorage.getItem(RESULTS_KEY);
      if(saved&&alive){try{setResults(JSON.parse(saved));}catch{}}
      try {
        const {data}=await getClient().auth.getSession();
        if(alive&&data.session){setSession(data.session);await loadTenants();}
      } catch (error) {
        if (alive) setMessage('Backend configuration unavailable: '+(error instanceof Error ? error.message : String(error)));
      }
      if(alive){setEvents([new Date().toISOString()+' · APP_LAUNCH · version '+(Application.nativeApplicationVersion??'unknown')]);}
    })();
    let listener: any = null;
    try { listener = getClient().auth.onAuthStateChange(async(_event,next)=>{
      setSession(next);
      if(next) await loadTenants(); else {setTenant(null);setTenants([]);setItems([]);setSelected(null);}
    }); } catch (error) { setMessage('Backend unavailable: '+(error instanceof Error ? error.message : String(error))); }
    return()=>{alive=false;listener?.subscription?.unsubscribe?.();};
  },[loadTenants]);

  const signIn=async()=>{
    setBusy(true);
    const {data,error}=await getClient().auth.signInWithPassword({email:email.trim(),password});
    setBusy(false);
    if(error){setMessage('Sign-in failed: '+error.message);return;}
    if(!isSwishMasterAdmin(data.user?.email)){await getClient().auth.signOut();setMessage('Access restricted to the SWISH Master Admin owner account.');return;}
    setPassword('');setSession(data.session);await loadTenants();setMessage('Owner authenticated. Tenant access is still enforced by backend membership policies.');
    void record('MASTER_ADMIN_SIGN_IN',data.user?.email??'owner');
  };
  const signOut=async()=>{await getClient().auth.signOut();setSession(null);setTenant(null);setTenants([]);setItems([]);setSelected(null);void record('SIGN_OUT');};

  const loadItems=useCallback(async()=>{
    if(!session||!tenant?.id||!specialistIds.length)return;
    setLoading(true);setSelected(null);setListing(null);setExternalId('');
    const {data,error}=await getClient().from('items')
      .select('id,canonical_title,description,expected_selling_price,condition,condition_notes,media,specialist_id,attributes,quantity,inventory_id,status')
      .eq('tenant_id',tenant.id).in('specialist_id',specialistIds)
      .not('canonical_title','is',null).order('updated_at',{ascending:false}).limit(100);
    if(error){setItems([]);setMessage('Inventory query failed: '+error.message);setLoading(false);return;}
    const {data:liveRows,error:liveError}=await getClient().from('listings').select('item_id')
      .eq('tenant_id',tenant.id).eq('marketplace_id','ebay').in('status',['active','live']);
    if(liveError){setItems([]);setMessage('Could not safely exclude already-live items: '+liveError.message);setLoading(false);return;}
    const live=new Set((liveRows??[]).map((row:any)=>row.item_id));
    const candidates=((data??[]) as Item[]).filter(item=>
      !live.has(item.id)&&!['sold','listed','active','disposed'].includes(String(item.status??'').toLowerCase())
      &&Number(item.expected_selling_price??0)>0
      &&Boolean(item.attributes?.ebay_category_id??item.attributes?._ebay_category_id)
      &&Array.isArray(item.media)&&item.media.some(url=>typeof url==='string'&&url.startsWith('https://'))
    );
    setItems(candidates);
    setMessage(candidates.length?'Loaded '+candidates.length+' eligible '+(nicheConfig?.shortName??niche)+' items. Live listings and items without price/category/photos are excluded.':'No safe test candidates in this niche. Items already live, sold, missing price/category or without HTTPS photos are excluded.');
    setLoading(false);void record('NICHE_INVENTORY_LOADED',niche+' · '+candidates.length+' eligible records');
  },[session,tenant?.id,specialistIds,niche,nicheConfig,record]);

  useEffect(()=>{if(session&&tenant?.id)void loadItems();},[session,tenant?.id,niche,loadItems]);

  const setResult=(stage:'create'|'revise'|'end',state:'waiting'|'passed'|'failed',detail:string)=>{
    setResults(prev=>{const next={...(prev[niche]??{create:'waiting',revise:'waiting',end:'waiting',detail:'Not run',at:new Date().toISOString()}),[stage]:state,detail,at:new Date().toISOString()} as Result;const all={...prev,[niche]:next};void AsyncStorage.setItem(RESULTS_KEY,JSON.stringify(all));return all;});
  };
  const fail=(stage:'create'|'revise'|'end',error:string)=>{setResult(stage,'failed',error);setMessage(error);setBusy(false);void record(stage.toUpperCase()+'_FAILED',error);};

  const createTest=()=>{
    if(!tenant?.id||!selected)return;
    const price=Number(selected.expected_selling_price??0);
    const title=('SWISH TEST '+(nicheConfig?.shortName??niche)+' - '+selected.canonical_title).slice(0,80);
    Alert.alert('Publish a separate live eBay test listing?', 'A clearly labelled temporary listing will be created using the selected item data. The original inventory row and any existing eBay listing are excluded. You must end the test listing in this app afterwards.',[
      {text:'Cancel',style:'cancel'},
      {text:'Publish test listing',style:'destructive',onPress:()=>void performCreate(price,title)}
    ]);
  };
  const performCreate=async(price:number,title:string)=>{
    if(!tenant?.id||!selected)return;
    setBusy(true);setResult('create','waiting','Creating test draft and publishing through SWISH shared listing service.');setMessage('Creating test listing…');
    const created=await createManualListing({tenantId:tenant.id,itemId:selected.id,marketplaceId:'ebay',title,description:'Temporary SWISH TEST LAB listing. Controlled shared-engine acceptance test. Not a customer listing. Ended after test.',price});
    if(created.error||!created.listing){fail('create',created.error??'Test draft creation not confirmed.');return;}
    setListing(created.listing);setTestTitle(title);
    const result=await submitListingToMarketplace(tenant.id,created.listing.id);
    if(!result.success||!result.externalListingId){
      const reason=result.error??'eBay did not confirm an external listing ID.';
      const unknown=/timeout|timed out|unknown outcome|not yet confirmed|reconcile/i.test(reason);
      if(!unknown)await deleteListing(created.listing.id,tenant.id);
      fail('create',reason+(unknown?' Test record retained for reconciliation; do not retry until eBay is checked.':' Test draft removed; inventory row retained.'));
      return;
    }
    const {data:row,error}=await getClient().from('listings').select('id,status,external_listing_id,title,price').eq('id',created.listing.id).eq('tenant_id',tenant.id).maybeSingle();
    if(error||!row||!['active','live'].includes(String(row.status).toLowerCase())||row.external_listing_id!==result.externalListingId||row.title!==title||Number(row.price)!==price){
      setExternalId(result.externalListingId);fail('create','eBay returned an ID, but SWISH read-back failed. Test record retained for reconciliation.');return;
    }
    setExternalId(String(row.external_listing_id));setResult('create','passed','eBay listing '+row.external_listing_id+' confirmed and SWISH row verified.');setMessage('CREATE PASSED — eBay ID '+row.external_listing_id+'. Next run REVISE.');setBusy(false);void record('CREATE_PASSED',String(row.external_listing_id));
  };

  const reviseTest=async()=>{
    if(!tenant?.id||!selected||!listing||!externalId)return;
    setBusy(true);setMessage('Revising temporary eBay test listing…');
    const nextTitle=(testTitle+' - REVISED').slice(0,80),nextPrice=Number((listing.price+0.01).toFixed(2));
    const titleUpdate=await updateListingTitle(listing.id,nextTitle);
    const priceUpdate=await updateListingPrice(listing.id,nextPrice);
    if(titleUpdate.error||priceUpdate.error){fail('revise',titleUpdate.error??priceUpdate.error??'Local revise preparation failed.');return;}
    const attrs=selected.attributes??{};
    const itemSpecifics=Object.entries(attrs).filter(([key,value])=>!key.startsWith('_')&&['string','number','boolean'].includes(typeof value)&&String(value).trim()).slice(0,25).map(([name,value])=>({name,value:String(value)}));
    const {data,error}=await getClient().functions.invoke('swish-ebay-list',{body:{
      route:'revise',tenantId:tenant.id,listingId:listing.id,externalListingId:externalId,title:nextTitle,
      description:'Temporary SWISH TEST LAB listing. Revised successfully by controlled acceptance test.',
      price:nextPrice,categoryId:attrs.ebay_category_id??attrs._ebay_category_id,
      condition:selected.condition??'',conditionDescription:selected.condition_notes??'',
      listingType:'FixedPriceItem',quantity:selected.quantity??1,sku:'SWISHTEST-'+selected.id.slice(0,8),
      itemSpecifics,mediaUrls:(selected.media??[]).filter(url=>typeof url==='string'&&url.startsWith('https://'))
    }});
    if(error||!data?.success){fail('revise',data?.error??error?.message??'eBay did not confirm revise.');return;}
    const {data:verified,error:readError}=await getClient().from('listings').select('title,price,external_listing_id').eq('id',listing.id).eq('tenant_id',tenant.id).maybeSingle();
    if(readError||!verified||verified.title!==nextTitle||Number(verified.price)!==nextPrice||verified.external_listing_id!==externalId){fail('revise','eBay accepted revise but SWISH read-back did not match. Retain for reconciliation.');return;}
    setTestTitle(nextTitle);setListing({...listing,title:nextTitle,price:nextPrice});setResult('revise','passed','eBay revise and SWISH title/price read-back verified.');setMessage('REVISE PASSED — updated title and price confirmed. Next run END.');setBusy(false);void record('REVISE_PASSED',externalId);
  };

  const endTest=()=>{
    if(!tenant?.id||!selected||!listing||!externalId)return;
    Alert.alert('End the temporary eBay listing?', 'This ends only the SWISH TEST LAB listing identified below. The original inventory item is retained.',[
      {text:'Cancel',style:'cancel'},
      {text:'End test listing',style:'destructive',onPress:()=>void performEnd()}
    ]);
  };
  const performEnd=async()=>{
    if(!tenant?.id||!selected||!listing||!externalId)return;
    setBusy(true);setMessage('Ending temporary eBay listing…');
    const ended=await endListing(listing.id,selected.id,tenant.id,externalId);
    if(ended.error){fail('end','eBay end failed; test record retained for reconciliation: '+ended.error);return;}
    const removed=await deleteListing(listing.id,tenant.id);
    if(removed.error){fail('end','eBay listing ended but test record cleanup failed: '+removed.error);return;}
    const {data:stillThere,error}=await getClient().from('listings').select('id').eq('id',listing.id).eq('tenant_id',tenant.id).maybeSingle();
    if(error||stillThere){fail('end','eBay end was requested but SWISH test-record removal could not be verified.');return;}
    setResult('end','passed','eBay end confirmed; temporary SWISH listing record removed. Inventory retained.');
    setMessage('CREATE → REVISE → END PASSED. Temporary listing ended and test record removed; original inventory remains.');setListing(null);setExternalId('');setBusy(false);void record('END_PASSED',externalId);
  };

  const result=results[niche];
  const stateLabel=(s:string)=>s==='passed'?'PASSED':s==='failed'?'FAILED':'WAITING';
  const button=(label:string,onPress:()=>void,disabled:boolean,danger=false)=><Pressable onPress={onPress} disabled={disabled} style={[styles.button,danger&&styles.danger,disabled&&styles.disabled]}><Text style={styles.buttonText}>{label}</Text></Pressable>;

  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.kicker}>SWISH ENGINE · STANDALONE ANDROID DIAGNOSTICS</Text>
    <Text style={styles.title}>Test Lab</Text>
    <Text style={styles.copy}>Independent package · OTA disabled · shared production backend and listing engine. This tool does not alter the production app packages.</Text>
    <View style={styles.card}>
      <Text style={styles.heading}>Master Admin access</Text>
      {session&&isSwishMasterAdmin(session.user?.email)?<>
        <Text style={styles.line}>Authenticated owner: {session.user.email}</Text>
        <Text style={styles.line}>Tenant access: {tenants.length} organisation(s) visible under existing membership policies.</Text>
        {tenants.length>1?<Picker selectedValue={tenant?.id??''} onValueChange={id=>setTenant(tenants.find(t=>t.id===id)??null)} style={styles.picker}>{tenants.map(t=><Picker.Item key={t.id} label={t.name} value={t.id}/>)}</Picker>:<Text style={styles.line}>Organisation: {tenant?.name??'No tenant available'}</Text>}
        {button('Sign out',()=>void signOut(),busy)}
      </>:<>
        <TextInput style={styles.input} autoCapitalize="none" keyboardType="email-address" placeholder="Master Admin email" placeholderTextColor="#89909D" value={email} onChangeText={setEmail}/>
        <TextInput style={styles.input} secureTextEntry placeholder="Password" placeholderTextColor="#89909D" value={password} onChangeText={setPassword}/>
        {button(busy?'Signing in…':'Sign in as Master Admin',()=>void signIn(),busy||!email||!password)}
      </>}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>Select niche</Text>
      <Text style={styles.line}>Every selection applies its registered specialist IDs at the database query. No global inventory query or client-side-only filtering.</Text>
      <Picker enabled={Boolean(session&&tenant?.id)&&!busy} selectedValue={niche} onValueChange={value=>{setNiche(value);setItems([]);setSelected(null);setListing(null);setExternalId('');}} style={styles.picker}>
        {PRODUCTION_NICHES.map(n=><Picker.Item key={n.id} label={n.shortName} value={n.id}/>)}
      </Picker>
      <Text style={styles.line}>Specialist boundary: {specialistIds.join(', ')}</Text>
      {button(loading?'Loading…':'Load eligible inventory',()=>void loadItems(),!session||!tenant?.id||loading||busy)}
      {loading?<ActivityIndicator color="#F2D21B"/>:items.map(item=><Pressable key={item.id} disabled={busy||Boolean(listing)} onPress={()=>setSelected(item)} style={[styles.item,selected?.id===item.id&&styles.selected]}><View style={{flex:1}}><Text style={styles.itemTitle}>{item.canonical_title}</Text><Text style={styles.line}>{item.specialist_id} · £{Number(item.expected_selling_price).toFixed(2)} · {item.media?.length??0} media</Text></View><Text style={styles.line}>{selected?.id===item.id?'SELECTED':'SELECT'}</Text></Pressable>)}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>Shared eBay lifecycle</Text>
      <Text style={styles.line}>CREATE: {stateLabel(result?.create??'waiting')}　 REVISE: {stateLabel(result?.revise??'waiting')}　 END: {stateLabel(result?.end??'waiting')}</Text>
      {selected?<><Text style={styles.itemTitle}>{selected.canonical_title}</Text><Text style={styles.line}>Category: {selected.attributes?.ebay_category_id??selected.attributes?._ebay_category_id} · Condition: {selected.condition??'—'} · Photos: {selected.media?.length??0}</Text></>:<Text style={styles.line}>Select a safe inventory item above.</Text>}
      {externalId?<Text style={styles.id}>Test eBay item ID: {externalId}</Text>:null}
      <Text style={styles.notice}>{message}</Text>
      {button('1 · Create separate live test listing',createTest,!selected||busy||Boolean(listing)||result?.create==='passed')}
      {button('2 · Revise test listing',()=>void reviseTest(),!listing||!externalId||busy||result?.create!=='passed'||result?.revise==='passed')}
      {button('3 · End test listing and clean up',endTest,!listing||!externalId||busy||result?.revise!=='passed',true)}
    </View>
    <View style={styles.card}>
      <Text style={styles.heading}>Niche test results</Text>
      {PRODUCTION_NICHES.map(n=>{const r=results[n.id];return <View key={n.id} style={styles.resultRow}><Text style={styles.line}>{n.shortName}</Text><Text style={styles.line}>{r?stateLabel(r.create)+' / '+stateLabel(r.revise)+' / '+stateLabel(r.end):'NOT RUN'}</Text></View>;})}
      <Text style={styles.heading}>Android lifecycle log</Text>
      <Text style={styles.line}>Version {Application.nativeApplicationVersion??'—'} · build {Application.nativeBuildVersion??'—'} · runtime {Updates.runtimeVersion??'—'} · OTA disabled</Text>
      {events.map((event,i)=><Text key={i} style={styles.event}>{event}</Text>)}
      {button('Record successful cold reopen',()=>void record('COLD_REOPEN_CONFIRMED','User confirmed app reopened after force-stop.'),false)}
    </View>
  </ScrollView>;
}

const styles=StyleSheet.create({
 page:{flexGrow:1,backgroundColor:'#09090E',padding:20,paddingTop:54,gap:14},
 kicker:{color:'#F2D21B',fontSize:10,fontWeight:'900',letterSpacing:1.4},title:{color:'#FFFFFF',fontSize:34,fontWeight:'900'},
 copy:{color:'#A8ADBA',fontSize:13,lineHeight:20},card:{backgroundColor:'#151720',borderColor:'#2A2E3A',borderWidth:1,borderRadius:16,padding:16,gap:10},
 heading:{color:'#FFFFFF',fontSize:17,fontWeight:'800'},line:{color:'#B8BECA',fontSize:11,lineHeight:17},
 input:{backgroundColor:'#0D1018',borderColor:'#353A49',borderWidth:1,borderRadius:9,padding:12,color:'#FFFFFF'},
 picker:{backgroundColor:'#0D1018',color:'#FFFFFF'},button:{backgroundColor:'#F2D21B',padding:13,borderRadius:9,alignItems:'center'},danger:{backgroundColor:'#F3A3A3'},
 buttonText:{color:'#111111',fontWeight:'900',fontSize:12},disabled:{opacity:0.35},item:{flexDirection:'row',alignItems:'center',gap:8,borderWidth:1,borderColor:'#343949',borderRadius:10,padding:10},
 selected:{borderColor:'#F2D21B',backgroundColor:'#F2D21115'},itemTitle:{color:'#FFFFFF',fontSize:13,fontWeight:'800'},notice:{color:'#E7DFAE',backgroundColor:'#292716',padding:10,borderRadius:8,fontSize:11,lineHeight:17},
 id:{color:'#F2D21B',fontSize:11,fontWeight:'800'},resultRow:{flexDirection:'row',justifyContent:'space-between',paddingVertical:4,borderBottomWidth:1,borderBottomColor:'#303544'},event:{color:'#89909D',fontSize:9}
});
