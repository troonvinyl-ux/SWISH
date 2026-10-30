import { View,Text,StyleSheet,Pressable,FlatList,ActivityIndicator,KeyboardAvoidingView,Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useGenericCapture } from '@/hooks/useGenericCapture';
import { useApp } from '@/hooks/useApp';
import { SPECIALISTS } from '@/constants/specialists';
import { SpecialistReview } from '@/components/feature/SpecialistReview';
import { PhotoQualityReview } from '@/components/feature/PhotoQualityReview';
import { FlipIntelligencePanel } from '@/components/feature/FlipIntelligencePanel';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
export default function CaptureScreen() {
  const capture=useGenericCapture(); const router=useRouter(); const { tenant }=useApp();
  return <SafeAreaView edges={['top','bottom']} style={s.screen}><StatusBar style="light"/>
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS==='ios' ? 'padding' : 'height'}>
    <FlatList data={capture.slots} keyExtractor={slot=>slot.id} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={s.block}>
        <Pressable accessibilityLabel="Back" onPress={()=>router.back()} style={({ pressed })=>[s.link,pressed ? s.pressed : null]}><MaterialIcons name="arrow-back" size={24} color={Colors.textPrimary}/><Text style={s.body}>Back</Text></Pressable>
        <View style={s.hero}><MaterialIcons name={capture.activeNiche.icon as any} size={28} color={capture.activeNiche.color}/><Text style={s.title}>{capture.activeNiche.terms.scan}</Text><Text style={s.body}>{capture.profile?.focus ?? 'Capture evidence for the selected specialist.'}</Text></View>
        <Pressable onPress={()=>router.push('/photo-quality-check' as any)} style={({ pressed })=>[s.link,pressed ? s.pressed : null]}><Text style={s.body}>Photo quality checks and device diagnostics</Text></Pressable>
        <Text style={s.body}>Your draft is retained on this device for this signed-in account. {Platform.OS==='web' ? 'Browser photos may need reselection after a browser restart.' : 'Captured photos remain on this device until managed in app storage.'}</Text>
        {!capture.images.length && !capture.result ? <>
          {capture.activeNiche.specialists.length>1 ? <View style={s.chipWrap}><FlatList horizontal data={capture.activeNiche.specialists} keyExtractor={id=>id} showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} renderItem={({ item:id })=><Pressable disabled={capture.busy} onPress={()=>capture.changeSpecialist(id)} style={({ pressed })=>[s.chip,capture.specialistId===id ? s.selected : null,pressed ? s.pressed : null]}><Text style={s.chipText}>{SPECIALISTS[id]?.shortName ?? id}</Text></Pressable>}/></View> : null}
          {capture.profile && capture.profile.modes.length>1 ? <View style={s.chipWrap}><FlatList horizontal data={capture.profile.modes} keyExtractor={mode=>mode.id} showsHorizontalScrollIndicator={false} contentContainerStyle={s.chips} renderItem={({ item:mode })=><Pressable disabled={capture.busy} onPress={()=>capture.changeMode(mode.id)} style={({ pressed })=>[s.chip,capture.mode===mode.id ? s.selected : null,pressed ? s.pressed : null]}><Text style={s.chipText}>{mode.label}</Text></Pressable>}/></View> : null}
        </> : null}
        {capture.error ? <View style={s.errorBox}><MaterialIcons name="error-outline" size={22} color={Colors.danger}/><Text style={[s.body,s.flex]}>{capture.error}</Text></View> : null}
        {capture.busy ? <View style={s.row}><ActivityIndicator color={Colors.primary}/><Text style={s.body}>{capture.phase || 'Loading retained draft'}</Text></View> : null}
        {capture.result ? <SpecialistReview result={capture.result} profile={capture.profile} answers={capture.answers} disabled={capture.busy || Boolean(capture.savedId)} onAnswer={capture.answer} onTitle={capture.correctTitle}/> : null}
      </View>}
      renderItem={({ item:slot })=>{
        const image=capture.images.find(i=>i.slotId===slot.id);
        return <View style={s.card}><Text style={s.section}>{slot.label}{slot.required ? ' · recommended evidence' : ''}</Text><Text style={s.body}>{slot.description}</Text>
          {image ? <Image source={{ uri:image.uri }} transition={200} contentFit="contain" style={s.photo}/> : null}
          {image?.photoQuality ? <PhotoQualityReview quality={image.photoQuality}/> : null}
          <View style={s.row}><Pressable disabled={capture.busy || Boolean(capture.savedId)} onPress={()=>{ void capture.capture(slot.id,false); }} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><MaterialIcons name="photo-camera" size={20} color={Colors.primary}/><Text style={s.body}>{image ? 'Retake' : 'Camera'}</Text></Pressable><Pressable disabled={capture.busy || Boolean(capture.savedId)} onPress={()=>{ void capture.capture(slot.id,true); }} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><Text style={s.body}>Upload photo</Text></Pressable></View>
        </View>;
      }}
      ListFooterComponent={<View style={s.block}>
        {capture.images.length && !capture.savedId ? <Pressable disabled={capture.busy} onPress={()=>capture.setAllowPhotoWarnings(!capture.allowPhotoWarnings)} accessibilityRole="checkbox" accessibilityState={{ checked:capture.allowPhotoWarnings }} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><MaterialIcons name={capture.allowPhotoWarnings ? 'check-box' : 'check-box-outline-blank'} size={24} color={Colors.primary}/><Text style={[s.body,s.flex]}>I reviewed these photos. Allow identification despite advisory warnings; confidence may be limited.</Text></Pressable> : null}
        {capture.activeNiche.id === 'trading_cards' ? <Pressable onPress={()=>router.push('/card-grading' as any)} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><MaterialIcons name="style" size={24} color={Colors.primary}/><Text style={s.body}>Compare raw versus graded sale scenarios</Text></Pressable> : null}
        {capture.result && !capture.savedId ? <>
          <Pressable disabled={capture.busy} onPress={()=>{ void capture.identify(); }} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><MaterialIcons name="refresh" size={20} color={Colors.info}/><Text style={s.body}>Re-analyse with my answers</Text></Pressable>
          <FlipIntelligencePanel key={capture.specialistId} result={capture.result} nicheId={capture.activeNiche.id} tenantId={tenant?.id}/>
        </> : null}
        <Pressable disabled={capture.busy || !capture.images.length || (Boolean(capture.result) && !capture.result?.canonicalTitle.trim())} onPress={()=>{ if(capture.savedId) router.push(`/stock-listing/${capture.savedId}` as any); else if(capture.result) void capture.save(); else void capture.identify(); }} style={({ pressed })=>[s.button,{ backgroundColor:capture.activeNiche.color },capture.busy || pressed || !capture.images.length ? s.pressed : null]}>
          <Text style={s.buttonText}>{capture.savedId ? 'View saved inventory item' : capture.result ? 'Save reviewed proposal to inventory' : 'Identify with specialist AI'}</Text>
        </Pressable>
        {capture.savedId ? <Pressable disabled={capture.busy} onPress={()=>{ void capture.save(); }} style={({ pressed })=>[s.secondary,pressed ? s.pressed : null]}><Text style={s.body}>Retry photo upload to saved item</Text></Pressable> : null}
        {capture.images.length ? <Pressable disabled={capture.busy} onPress={capture.reset} style={({ pressed })=>[s.link,pressed ? s.pressed : null]}><Text style={s.body}>{capture.savedId ? 'Start another scan' : 'Discard this draft and start again'}</Text></Pressable> : null}
      </View>}
    />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
const s=StyleSheet.create({ screen:{ flex:1,backgroundColor:Colors.background },content:{ padding:Spacing.base,gap:Spacing.md,maxWidth:960,width:'100%',alignSelf:'center',paddingBottom:Spacing.xl },block:{ gap:Spacing.md },hero:{ backgroundColor:Colors.surface,padding:Spacing.base,gap:Spacing.sm,borderRadius:Radius.lg,borderLeftWidth:4,borderLeftColor:Colors.primary },title:{ color:Colors.textPrimary,fontSize:Typography.size.xl,fontWeight:Typography.weight.bold },section:{ color:Colors.textPrimary,fontSize:Typography.size.md,fontWeight:Typography.weight.semibold },body:{ color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false },card:{ gap:Spacing.sm,padding:Spacing.md,backgroundColor:Colors.surface,borderRadius:Radius.lg },row:{ flexDirection:'row',gap:Spacing.sm,alignItems:'center',flexWrap:'wrap' },secondary:{ flexDirection:'row',gap:Spacing.sm,padding:Spacing.md,minHeight:48,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight,alignItems:'center' },button:{ minHeight:48,padding:Spacing.base,borderRadius:Radius.md,alignItems:'center' },buttonText:{ color:Colors.background,fontSize:Typography.size.base,fontWeight:Typography.weight.bold,textAlign:'center' },photo:{ width:'100%',height:180,borderRadius:Radius.md },errorBox:{ backgroundColor:Colors.dangerDim,padding:Spacing.md,borderRadius:Radius.md,flexDirection:'row',gap:Spacing.sm },flex:{ flex:1 },link:{ minHeight:48,justifyContent:'center',flexDirection:'row',alignItems:'center',gap:Spacing.sm },pressed:{ opacity:0.65 },chipWrap:{ minHeight:56 },chips:{ gap:Spacing.sm,alignItems:'center' },chip:{ height:48,borderRadius:Radius.pill,paddingHorizontal:Spacing.base,justifyContent:'center',backgroundColor:Colors.surfaceHighlight,borderWidth:1,borderColor:Colors.surfaceBorder },selected:{ backgroundColor:Colors.primaryDim,borderColor:Colors.primary },chipText:{ color:Colors.textPrimary,fontSize:Typography.size.base } });
