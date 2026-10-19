import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack } from 'expo-router';
import { getSupabaseClient, useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Row = { id: string; canonical_title: string; sku: string | null; quantity: number | null; expected_selling_price: number | null; status: string; media: string[] | null; checked: boolean; qtyText: string; priceText: string; };
const SURPLUS_IDS = ['surplus_trader', 'surplus_flip'];
export default function StockCheckPage() {
  const { user } = useAuth();
  const { tenant, tenantLoading } = useApp();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true); setError(''); setNotice('');
    try {
      const supabase = getSupabaseClient();
      const { data, error: queryError } = await supabase.from('items')
        .select('id, canonical_title, sku, quantity, expected_selling_price, status, media')
        .eq('tenant_id', tenant.id).in('specialist_id', SURPLUS_IDS)
        .order('created_at', { ascending: false }).limit(1000);
      if (queryError) throw queryError;
      setRows((data ?? []).map((r: any) => ({ ...r, sku: r.sku ?? null, quantity: r.quantity ?? 1, expected_selling_price: r.expected_selling_price ?? null, media: r.media ?? [], checked: true, qtyText: String(r.quantity ?? 1), priceText: r.expected_selling_price == null ? '' : String(r.expected_selling_price) })));
    } catch (e: any) { setError(e?.message ?? 'Could not load inventory.'); }
    finally { setLoading(false); }
  }, [tenant?.id]);
  useEffect(() => { if (tenant?.id) void load(); else if (!tenantLoading) setLoading(false); }, [tenant?.id, tenantLoading, load]);

  const visible = useMemo(() => rows.filter(r => (r.canonical_title ?? '').toLowerCase().includes(search.toLowerCase()) || (r.sku ?? '').toLowerCase().includes(search.toLowerCase())), [rows, search]);
  const checked = rows.filter(r => r.checked);
  const changed = rows.filter(r => r.checked && (r.qtyText !== String(r.quantity ?? 1) || r.priceText !== (r.expected_selling_price == null ? '' : String(r.expected_selling_price))));
  const update = (id: string, patch: Partial<Row>) => { setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r)); setNotice(''); };
  const save = async () => {
    if (!tenant?.id || !user?.id) { setError('Sign in to save inventory changes.'); return; }
    const bad = checked.find(r => !/^\\d+$/.test(r.qtyText) || Number(r.qtyText) < 0 || (r.priceText.trim() !== '' && (!Number.isFinite(Number(r.priceText)) || Number(r.priceText) < 0)));
    if (bad) { setError('Check quantity and price for: ' + bad.canonical_title); return; }
    setSaving(true); setError(''); setNotice('');
    try {
      const supabase = getSupabaseClient();
      for (const r of changed) {
        const patch: Record<string, number> = { quantity: Number(r.qtyText) };
        if (r.priceText.trim() !== '') patch.expected_selling_price = Math.round(Number(r.priceText) * 100) / 100;
        const { error: updateError } = await supabase.from('items').update(patch).eq('id', r.id).eq('tenant_id', tenant.id);
        if (updateError) throw new Error(r.canonical_title + ': ' + updateError.message);
        setRows(prev => prev.map(x => x.id === r.id ? { ...x, quantity: Number(x.qtyText), expected_selling_price: x.priceText.trim() === '' ? x.expected_selling_price : Math.round(Number(x.priceText) * 100) / 100 } : x));
      }
      setNotice('Saved ' + changed.length + ' item(s). Unchecked items were not changed.'); setReviewOpen(false);
    } catch (e: any) { setError(e?.message ?? 'Save failed. Check connection and permissions before retrying.'); }
    finally { setSaving(false); }
  };

  if (!user) return <View style={[s.center,{paddingTop:insets.top}]}><Text style={s.title}>SWISH Stock Check</Text><Text style={s.muted}>Please sign in through the SWISH app to access inventory.</Text></View>;
  return <View style={[s.page,{paddingTop:Math.max(insets.top,16)}]}>
    <Stack.Screen options={{ title: 'SWISH Stock Check', headerShown: true }} />
    <View style={s.header}><View style={{flex:1}}><Text style={s.title}>Stock Check</Text><Text style={s.muted}>Shared SWISH inventory · Surplus Flip</Text></View><Pressable style={s.secondary} onPress={load}><Text style={s.buttonText}>Refresh</Text></Pressable></View>
    <View style={s.stats}><Text style={s.stat}>{rows.length} items</Text><Text style={s.stat}>{checked.length} selected</Text><Text style={s.stat}>{changed.length} changed</Text></View>
    <TextInput value={search} onChangeText={setSearch} placeholder="Search title or SKU…" placeholderTextColor="#85859a" style={s.search}/>
    <View style={s.bulk}><Pressable onPress={()=>setRows(p=>p.map(r=>({...r,checked:true})))}><Text style={s.link}>Select all</Text></Pressable><Pressable onPress={()=>setRows(p=>p.map(r=>({...r,checked:false})))}><Text style={s.link}>Select none</Text></Pressable><Pressable onPress={()=>setReviewOpen(v=>!v)}><Text style={s.link}>{reviewOpen?'Hide review':'Review changes'}</Text></Pressable></View>
    {reviewOpen && <View style={s.review}><Text style={s.rowTitle}>Review before saving</Text><Text style={s.muted}>{checked.length} selected · {changed.length} with edited quantity or price. Unchecked rows are skipped. Empty price fields leave the existing selling price unchanged.</Text>{changed.slice(0,8).map(r=><Text key={r.id} style={s.muted}>• {r.canonical_title}: qty {r.qtyText}, price {r.priceText || 'unchanged'}</Text>)}</View>}
    {error ? <Text style={s.error}>{error}</Text> : null}{notice ? <Text style={s.success}>{notice}</Text> : null}
    {loading ? <ActivityIndicator color="#10b7a4" size="large"/> : <FlatList data={visible} keyExtractor={r=>r.id} contentContainerStyle={{paddingBottom:120}} ListEmptyComponent={<Text style={s.muted}>No matching Surplus inventory items.</Text>} renderItem={({item})=><View style={[s.card,!item.checked&&s.unchecked]}><Pressable style={s.check} onPress={()=>update(item.id,{checked:!item.checked})}><Text style={s.checkText}>{item.checked?'✓':'□'}</Text></Pressable><View style={{flex:1,gap:8}}><Text style={s.rowTitle}>{item.canonical_title || 'Untitled item'}</Text><Text style={s.muted}>{item.sku || 'No SKU'} · {item.status}</Text><View style={s.fields}><View style={{flex:1}}><Text style={s.label}>Quantity</Text><TextInput keyboardType="number-pad" value={item.qtyText} onChangeText={v=>update(item.id,{qtyText:v})} style={s.input}/></View><View style={{flex:1}}><Text style={s.label}>Selling price (£)</Text><TextInput keyboardType="decimal-pad" value={item.priceText} onChangeText={v=>update(item.id,{priceText:v})} placeholder="Unchanged" placeholderTextColor="#85859a" style={s.input}/></View></View></View></View>}/>}
    <View style={[s.footer,{paddingBottom:Math.max(insets.bottom,12)}]}><Pressable disabled={saving||changed.length===0} onPress={()=>setReviewOpen(true)} style={[s.save,s.secondaryButton]}><Text style={s.buttonText}>Review {changed.length} changes</Text></Pressable><Pressable disabled={saving||changed.length===0} onPress={save} style={[s.save,(saving||changed.length===0)&&{opacity:.45}]}><Text style={s.saveText}>{saving?'Saving…':'Save checked changes'}</Text></Pressable></View>
  </View>;
}
const s=StyleSheet.create({page:{flex:1,backgroundColor:'#09090e',paddingHorizontal:16,gap:12},center:{flex:1,backgroundColor:'#09090e',alignItems:'center',justifyContent:'center',padding:24,gap:12},header:{flexDirection:'row',alignItems:'center',gap:10},title:{color:'#10b7a4',fontSize:26,fontWeight:'800'},muted:{color:'#a0a0b2',fontSize:13},stats:{flexDirection:'row',justifyContent:'space-between'},stat:{color:'#10b7a4',fontWeight:'700'},search:{backgroundColor:'#15151e',borderColor:'#292936',borderWidth:1,borderRadius:12,padding:12,color:'#fff'},bulk:{flexDirection:'row',justifyContent:'space-between'},link:{color:'#38c9b6',fontWeight:'700'},card:{flexDirection:'row',gap:10,padding:12,borderRadius:14,backgroundColor:'#14141d',borderColor:'#292936',borderWidth:1},unchecked:{opacity:.55},check:{width:32,height:32,borderRadius:8,backgroundColor:'#083b34',alignItems:'center',justifyContent:'center'},checkText:{fontSize:22,color:'#10b7a4',fontWeight:'800'},rowTitle:{color:'#fff',fontSize:15,fontWeight:'700'},fields:{flexDirection:'row',gap:10},label:{color:'#a0a0b2',fontSize:12,marginBottom:4},input:{backgroundColor:'#20202b',borderRadius:8,padding:9,color:'#fff',borderWidth:1,borderColor:'#333344'},review:{backgroundColor:'#102923',padding:12,borderRadius:12,gap:6},error:{color:'#ff7777'},success:{color:'#53dfaa'},footer:{position:'absolute',bottom:0,left:0,right:0,backgroundColor:'#101018',padding:12,flexDirection:'row',gap:10},save:{flex:1,backgroundColor:'#0c9f90',padding:14,borderRadius:12,alignItems:'center'},secondaryButton:{backgroundColor:'#30303c'},buttonText:{color:'#fff',fontWeight:'700'},saveText:{color:'#041310',fontWeight:'800'}});
