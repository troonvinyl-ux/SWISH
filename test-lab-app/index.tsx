import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, Pressable, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';
import { getSupabaseClient } from '@/template';

type EventRow = { at: string; event: string; detail?: string };
const client = getSupabaseClient();
const KEY = 'swish.testlab.events.v1';

export default function TestLabHome() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [session, setSession] = useState<any>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [backend, setBackend] = useState('Not tested');

  const record = async (event: string, detail?: string) => {
    const row = { at: new Date().toISOString(), event, detail };
    const next = [row, ...events].slice(0, 40);
    setEvents(next);
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await AsyncStorage.getItem(KEY);
      if (saved && alive) setEvents(JSON.parse(saved));
      const { data } = await client.auth.getSession();
      if (alive) setSession(data.session);
      await record('APP_LAUNCH', `version=${Application.nativeApplicationVersion ?? 'unknown'} updateId=${Updates.updateId ?? 'embedded'}`);
    })();
    const { data: listener } = client.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => { alive = false; listener.subscription.unsubscribe(); };
  }, []);

  const signIn = async () => {
    setBusy(true);
    const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    await record(error ? 'SIGN_IN_FAILED' : 'SIGN_IN_SUCCESS', error?.message ?? data.user?.id);
    if (error) Alert.alert('Sign-in failed', error.message);
    else setPassword('');
  };
  const signOut = async () => {
    setBusy(true);
    const { error } = await client.auth.signOut();
    setBusy(false);
    await record(error ? 'SIGN_OUT_FAILED' : 'SIGN_OUT_SUCCESS', error?.message);
    if (error) Alert.alert('Sign-out failed', error.message);
  };
  const checkBackend = async () => {
    setBusy(true); setBackend('Testing authenticated backend connection…');
    const { data, error } = await client.auth.getUser();
    const result = error ? error.message : data.user ? `Authenticated as ${data.user.email ?? data.user.id}` : 'Backend reachable; signed out';
    setBackend(result); await record('BACKEND_CHECK', result); setBusy(false);
  };

  return <ScrollView contentContainerStyle={s.page}>
    <Text style={s.kicker}>SWISH ENGINE · ISOLATED ANDROID BUILD</Text>
    <Text style={s.title}>Test Lab</Text>
    <Text style={s.copy}>A separate app identity for repeatable Android startup and authentication tests. OTA updates are disabled in this build.</Text>
    <View style={s.card}>
      <Text style={s.heading}>App diagnostics</Text>
      <Text style={s.line}>Version: {Application.nativeApplicationVersion ?? '—'} ({Application.nativeBuildVersion ?? '—'})</Text>
      <Text style={s.line}>Runtime: {Updates.runtimeVersion ?? '—'}</Text>
      <Text style={s.line}>Update ID: {Updates.updateId ?? 'embedded / OTA disabled'}</Text>
      <Pressable style={s.button} onPress={() => void record('MANUAL_REOPEN_CHECK', 'Tap after a successful cold reopen')}><Text style={s.buttonText}>Record successful reopen</Text></Pressable>
    </View>
    <View style={s.card}>
      <Text style={s.heading}>Authentication</Text>
      {session ? <>
        <Text style={s.line}>Signed in: {session.user?.email ?? session.user?.id}</Text>
        <Pressable disabled={busy} style={s.button} onPress={() => void signOut()}><Text style={s.buttonText}>Sign out</Text></Pressable>
      </> : <>
        <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" placeholder="Email" placeholderTextColor="#89909D" value={email} onChangeText={setEmail}/>
        <TextInput style={s.input} secureTextEntry placeholder="Password" placeholderTextColor="#89909D" value={password} onChangeText={setPassword}/>
        <Pressable disabled={busy || !email || !password} style={s.button} onPress={() => void signIn()}><Text style={s.buttonText}>Sign in</Text></Pressable>
      </>}
      <Pressable disabled={busy} style={s.outline} onPress={() => void checkBackend()}><Text style={s.outlineText}>Check backend / session</Text></Pressable>
      <Text style={s.line}>Backend: {backend}</Text>
    </View>
    <View style={s.card}>
      <Text style={s.heading}>Lifecycle event log</Text>
      <Text style={s.line}>Each launch is recorded locally. Close or force-stop the app, reopen it, and check that APP_LAUNCH increments.</Text>
      {events.map((e,i)=><View key={e.at+i} style={s.event}><Text style={s.eventName}>{e.event}</Text><Text style={s.eventDetail}>{e.at} {e.detail ?? ''}</Text></View>)}
      <Pressable style={s.outline} onPress={() => Alert.alert('Clear local test log?', 'This clears only this device’s diagnostic history.', [{text:'Cancel',style:'cancel'},{text:'Clear',style:'destructive',onPress:async()=>{setEvents([]);await AsyncStorage.removeItem(KEY);}}])}><Text style={s.outlineText}>Clear local test log</Text></Pressable>
    </View>
  </ScrollView>;
}
const s=StyleSheet.create({
 page:{flexGrow:1,backgroundColor:'#09090E',padding:20,paddingTop:56,gap:14},
 kicker:{color:'#F2D21B',fontSize:11,fontWeight:'900',letterSpacing:1.5},title:{color:'#FFFFFF',fontSize:34,fontWeight:'900'},
 copy:{color:'#A8ADBA',fontSize:14,lineHeight:21},card:{backgroundColor:'#151720',borderColor:'#2A2E3A',borderWidth:1,borderRadius:16,padding:16,gap:10},
 heading:{color:'#FFFFFF',fontSize:18,fontWeight:'800'},line:{color:'#B8BECA',fontSize:12,lineHeight:18},
 input:{backgroundColor:'#0D1018',borderColor:'#353A49',borderWidth:1,borderRadius:9,padding:12,color:'#FFFFFF'},
 button:{backgroundColor:'#F2D21B',padding:13,borderRadius:9,alignItems:'center'},buttonText:{color:'#111111',fontWeight:'900'},
 outline:{borderColor:'#F2D21B',borderWidth:1,padding:12,borderRadius:9,alignItems:'center'},outlineText:{color:'#F2D21B',fontWeight:'800'},
 event:{borderTopColor:'#303544',borderTopWidth:1,paddingTop:8,gap:3},eventName:{color:'#F2D21B',fontWeight:'800',fontSize:12},eventDetail:{color:'#9DA4B3',fontSize:10}
});
