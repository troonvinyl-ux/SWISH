import { View,Text,Pressable,StyleSheet,FlatList,ActivityIndicator,Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { usePhotoQualityDiagnostics } from '@/hooks/usePhotoQualityDiagnostics';
import { PhotoQualityReview } from '@/components/feature/PhotoQualityReview';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
export default function PhotoQualityCheckScreen() {
  const diagnostics=usePhotoQualityDiagnostics();const router=useRouter();
  return <SafeAreaView edges={['top','bottom']} style={s.screen}><StatusBar style="light"/>
    <FlatList data={diagnostics.tests} keyExtractor={test=>test.name} showsVerticalScrollIndicator={false} contentContainerStyle={s.content}
      ListHeaderComponent={<View style={s.block}>
        <Pressable onPress={()=>router.back()} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><Text style={s.body}>Back</Text></Pressable>
        <Text style={s.title}>Photo quality · Device checks</Text><Text style={s.body}>Runtime: {Platform.OS}. Pixel checks run locally, with no identification or AI requests. Diagnostics test the actual thumbnail and decoder pipeline, not a professional image-quality assessment.</Text>
        <Pressable onPress={()=>{ void diagnostics.run(); }} disabled={diagnostics.busy} style={({ pressed })=>[s.button,pressed || diagnostics.busy ? s.pressed : null]}><Text style={s.buttonText}>Run four device fixture checks</Text></Pressable>
        {diagnostics.tests.length ? <Text style={s.body}>{diagnostics.tests.filter(test=>test.passed).length} passed / {diagnostics.tests.filter(test=>!test.passed).length} failed on this runtime.</Text> : <Text style={s.body}>Not run on this device.</Text>}
        {diagnostics.busy ? <ActivityIndicator color={Colors.primary}/> : null}
        {diagnostics.error ? <Text accessibilityRole="alert" style={[s.body,{ color:Colors.danger }]}>{diagnostics.error}</Text> : null}
      </View>}
      renderItem={({ item:test })=><View style={s.card}><Text style={s.section}>{test.name} · {test.passed ? 'Passed' : 'Failed'}</Text><Text style={s.body}>Expected: {test.expected}</Text><Text style={s.body}>Measurement duration: {test.quality.durationMs ?? 0} ms</Text><PhotoQualityReview quality={test.quality}/></View>}
      ListFooterComponent={<View style={s.block}><Text style={s.section}>Manual camera / gallery check</Text><Text style={s.body}>Photograph a clear label, repeat with defocus and low light, then retake. Confirm that the warnings and metrics change and the UI remains responsive. Cancellation and denied permission must not trigger AI.</Text>
        <Pressable disabled={diagnostics.busy} onPress={()=>{ void diagnostics.inspect(false); }} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><Text style={s.body}>Take / retake diagnostic photo</Text></Pressable>
        <Pressable disabled={diagnostics.busy} onPress={()=>{ void diagnostics.inspect(true); }} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><Text style={s.body}>Select diagnostic photo from gallery</Text></Pressable>
        {diagnostics.photo ? <Image source={{ uri:diagnostics.photo.uri }} transition={200} contentFit="contain" style={s.photo}/> : null}
        {diagnostics.photo?.photoQuality ? <PhotoQualityReview quality={diagnostics.photo.photoQuality}/> : null}
      </View>}
    />
  </SafeAreaView>;
}
const s=StyleSheet.create({ screen:{ flex:1,backgroundColor:Colors.background },content:{ width:'100%',maxWidth:960,alignSelf:'center',padding:Spacing.base,gap:Spacing.base,paddingBottom:Spacing.xl },block:{ gap:Spacing.base },card:{ gap:Spacing.sm,padding:Spacing.base,borderRadius:Radius.lg,backgroundColor:Colors.surface },title:{ color:Colors.textPrimary,fontSize:Typography.size.xl,fontWeight:Typography.weight.bold },section:{ color:Colors.textPrimary,fontSize:Typography.size.md,fontWeight:Typography.weight.semibold },body:{ color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false },button:{ padding:Spacing.base,minHeight:48,justifyContent:'center',alignItems:'center',backgroundColor:Colors.primary,borderRadius:Radius.md },buttonText:{ color:Colors.textInverse,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold },secondary:{ padding:Spacing.base,minHeight:48,backgroundColor:Colors.surfaceHighlight,borderRadius:Radius.md },pressed:{ opacity:0.65 },photo:{ width:'100%',height:240,borderRadius:Radius.md } });
