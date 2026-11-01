import React from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useGenericCapture } from '@/hooks/useGenericCapture';
import { useApp } from '@/hooks/useApp';
import { SpecialistReview } from '@/components/feature/SpecialistReview';
import { PhotoQualityReview } from '@/components/feature/PhotoQualityReview';
import { FlipIntelligencePanel } from '@/components/feature/FlipIntelligencePanel';
import { BrandArtwork } from '@/components/feature/BrandArtwork';

const GOLD = '#D8AD52';
const BG = '#100D09';
const PANEL = '#1B1711';
const MUTED = '#B9AD98';

export default function AntiqueCaptureScreen() {
  const capture = useGenericCapture();
  const router = useRouter();
  const { tenant } = useApp();
  const complete = capture.slots.filter(slot => capture.images.some(image => image.slotId === slot.id)).length;
  const progress = capture.slots.length ? complete / capture.slots.length : 0;

  return (
    <SafeAreaView edges={['top','bottom']} style={s.screen}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={s.topbar}>
          <Pressable onPress={() => router.back()} style={s.back}><MaterialIcons name="arrow-back" size={22} color={GOLD}/><Text style={s.backText}>WORKSPACE</Text></Pressable>
          <View style={s.live}><View style={s.dot}/><Text style={s.liveText}>AI IDENTIFICATION</Text></View>
        </View>

        <View style={s.hero}>
          <View style={s.heroCopy}>
            <Text style={s.eyebrow}>ANTIQUE FLIPPER · DISCOVERY STUDIO</Text>
            <Text style={s.title}>Identify your find.</Text>
            <Text style={s.subtitle}>Capture the object, its maker's marks and condition. Our specialist AI will build an evidence-led identification.</Text>
          </View>
          <View style={s.art}><BrandArtwork nicheId="antiques" compact/></View>
        </View>

        <View style={s.progressCard}>
          <View style={s.progressHead}><Text style={s.progressTitle}>CAPTURE EVIDENCE</Text><Text style={s.progressCount}>{complete} / {capture.slots.length} views</Text></View>
          <View style={s.track}><View style={[s.fill,{width: progress * 100 + '%'}]}/></View>
          <Text style={s.hint}>Start with a full view. Add marks and details to improve attribution.</Text>
        </View>

        {capture.error ? <View style={s.error}><MaterialIcons name="error-outline" size={20} color="#FF8A72"/><Text style={s.errorText}>{capture.error}</Text></View> : null}
        {capture.busy ? <View style={s.busy}><ActivityIndicator color={GOLD}/><Text style={s.hint}>{capture.phase || 'Preparing your identification…'}</Text></View> : null}

        <View style={s.sectionHead}><Text style={s.sectionTitle}>PHOTOGRAPH THE OBJECT</Text><Text style={s.sectionSub}>Tap a view to add a photograph</Text></View>
        <View style={s.grid}>
          {capture.slots.map((slot,index) => {
            const image = capture.images.find(item => item.slotId === slot.id);
            return <View key={slot.id} style={[s.slot,index === 0 ? s.featureSlot : null]}>
              <View style={s.slotTop}>
                <View style={s.number}><Text style={s.numberText}>{String(index + 1).padStart(2,'0')}</Text></View>
                <View style={s.slotCopy}><Text style={s.slotTitle}>{slot.label}</Text><Text style={s.slotDesc}>{slot.description}</Text></View>
                {image ? <MaterialIcons name="check-circle" size={21} color={GOLD}/> : <MaterialIcons name="add-a-photo" size={21} color={MUTED}/>}
              </View>
              {image ? <Image source={{uri:image.uri}} contentFit="contain" transition={180} style={s.photo}/> : <View style={s.photoPlaceholder}><MaterialIcons name="photo-camera" size={30} color={GOLD}/><Text style={s.placeholderText}>PHOTO NOT ADDED</Text></View>}
              {image?.photoQuality ? <PhotoQualityReview quality={image.photoQuality}/> : null}
              <View style={s.actions}>
                <Pressable disabled={capture.busy || Boolean(capture.savedId)} onPress={() => { void capture.capture(slot.id,false); }} style={s.cameraButton}><MaterialIcons name="photo-camera" size={18} color={BG}/><Text style={s.cameraText}>{image ? 'Retake photo' : 'Take photo'}</Text></Pressable>
                <Pressable disabled={capture.busy || Boolean(capture.savedId)} onPress={() => { void capture.capture(slot.id,true); }} style={s.uploadButton}><MaterialIcons name="photo-library" size={18} color={GOLD}/><Text style={s.uploadText}>Gallery</Text></Pressable>
              </View>
            </View>;
          })}
        </View>

        <View style={s.tip}><MaterialIcons name="lightbulb-outline" size={22} color={GOLD}/><View style={{flex:1}}><Text style={s.tipTitle}>A note on maker marks</Text><Text style={s.hint}>Photograph the entire mark straight-on, then take a close-up. We distinguish visible evidence from possible attributions.</Text></View></View>

        {capture.result ? <View style={s.result}><Text style={s.sectionTitle}>IDENTIFICATION REVIEW</Text><SpecialistReview result={capture.result} profile={capture.profile} answers={capture.answers} disabled={capture.busy || Boolean(capture.savedId)} onAnswer={capture.answer} onTitle={capture.correctTitle}/><FlipIntelligencePanel key={capture.specialistId} result={capture.result} nicheId={capture.activeNiche.id} tenantId={tenant?.id}/></View> : null}

        {capture.images.length && !capture.savedId ? <Pressable onPress={() => capture.setAllowPhotoWarnings(!capture.allowPhotoWarnings)} style={s.warningToggle}><MaterialIcons name={capture.allowPhotoWarnings ? 'check-box' : 'check-box-outline-blank'} size={22} color={GOLD}/><Text style={s.hint}>I have reviewed the photos and want to continue despite any advisory warnings.</Text></Pressable> : null}

        <Pressable disabled={capture.busy || !capture.images.length || (Boolean(capture.result) && !capture.result?.canonicalTitle.trim())} onPress={() => { if (capture.savedId) router.push(`/stock-listing/${capture.savedId}` as any); else if (capture.result) void capture.save(); else void capture.identify(); }} style={[s.primaryButton,(!capture.images.length || capture.busy) && s.disabled]}>
          <MaterialIcons name={capture.savedId ? 'inventory' : capture.result ? 'save' : 'auto-awesome'} size={21} color={BG}/>
          <Text style={s.primaryText}>{capture.savedId ? 'VIEW SAVED INVENTORY ITEM' : capture.result ? 'SAVE TO ANTIQUE INVENTORY' : 'IDENTIFY THIS ANTIQUE'}</Text>
          <MaterialIcons name="arrow-forward" size={20} color={BG}/>
        </Pressable>
        {capture.savedId ? <Pressable onPress={() => { void capture.save(); }} style={s.secondaryButton}><Text style={s.uploadText}>Retry photo upload</Text></Pressable> : null}
        {capture.result && !capture.savedId ? <Pressable disabled={capture.busy} onPress={() => { void capture.identify(); }} style={s.secondaryButton}><Text style={s.uploadText}>RE-RUN WITH MY ANSWERS</Text></Pressable> : null}
        {capture.images.length > 0 ? <Pressable disabled={capture.busy} onPress={capture.reset} style={s.reset}><Text style={s.hint}>Start a new identification</Text></Pressable> : null}
        <Text style={s.footer}>Evidence-led assistance · Always verify important attributions, provenance and material claims independently.</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:{flex:1,backgroundColor:BG},content:{padding:18,gap:18,maxWidth:980,width:'100%',alignSelf:'center',paddingBottom:42},
  topbar:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},back:{flexDirection:'row',alignItems:'center',gap:8,minHeight:42},backText:{color:GOLD,fontSize:11,fontWeight:'800',letterSpacing:1.5},live:{flexDirection:'row',alignItems:'center',gap:7},dot:{width:7,height:7,borderRadius:5,backgroundColor:'#69C58A'},liveText:{color:MUTED,fontSize:10,fontWeight:'800',letterSpacing:1.2},
  hero:{backgroundColor:PANEL,borderWidth:1,borderColor:'#55452B',borderRadius:22,padding:20,flexDirection:'row',alignItems:'center',gap:12,minHeight:170},heroCopy:{flex:1,gap:9},eyebrow:{color:GOLD,fontSize:10,fontWeight:'800',letterSpacing:1.5},title:{color:'#F8F1E5',fontSize:30,fontWeight:'900',letterSpacing:-.7},subtitle:{color:MUTED,fontSize:13,lineHeight:20},art:{width:94,height:100,overflow:'hidden',justifyContent:'center'},
  progressCard:{backgroundColor:PANEL,borderRadius:16,padding:16,gap:10,borderWidth:1,borderColor:'#3A3022'},progressHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},progressTitle:{color:'#F3E8D5',fontSize:12,fontWeight:'900',letterSpacing:1},progressCount:{color:GOLD,fontSize:12,fontWeight:'800'},track:{height:7,backgroundColor:'#393126',borderRadius:6,overflow:'hidden'},fill:{height:7,backgroundColor:GOLD,borderRadius:6},hint:{color:MUTED,fontSize:12,lineHeight:18},sectionHead:{gap:4,marginTop:4},sectionTitle:{color:'#F3E8D5',fontSize:13,fontWeight:'900',letterSpacing:1.3},sectionSub:{color:MUTED,fontSize:12},
  grid:{gap:12},slot:{backgroundColor:PANEL,borderRadius:17,padding:14,borderWidth:1,borderColor:'#3A3022',gap:12},featureSlot:{borderColor:'#8B6B35'},slotTop:{flexDirection:'row',alignItems:'center',gap:11},number:{width:34,height:34,borderRadius:11,backgroundColor:'#332719',alignItems:'center',justifyContent:'center'},numberText:{color:GOLD,fontWeight:'900',fontSize:12},slotCopy:{flex:1,gap:3},slotTitle:{color:'#F8F1E5',fontSize:15,fontWeight:'800'},slotDesc:{color:MUTED,fontSize:11,lineHeight:16},photo:{width:'100%',height:190,borderRadius:12,backgroundColor:'#0C0A07'},photoPlaceholder:{height:120,borderRadius:12,backgroundColor:'#120F0B',borderWidth:1,borderStyle:'dashed',borderColor:'#5A472B',alignItems:'center',justifyContent:'center',gap:8},placeholderText:{color:'#8F816C',fontSize:9,fontWeight:'800',letterSpacing:1.5},
  actions:{flexDirection:'row',gap:9},cameraButton:{flex:1,minHeight:46,backgroundColor:GOLD,borderRadius:11,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7},cameraText:{color:BG,fontWeight:'900',fontSize:12},uploadButton:{minWidth:112,minHeight:46,borderRadius:11,borderWidth:1,borderColor:'#6A5431',alignItems:'center',justifyContent:'center',flexDirection:'row',gap:7},uploadText:{color:GOLD,fontSize:12,fontWeight:'800'},
  tip:{flexDirection:'row',gap:12,padding:15,backgroundColor:'#211A10',borderRadius:14,borderWidth:1,borderColor:'#55452B'},tipTitle:{color:'#F3E8D5',fontWeight:'800',fontSize:13,marginBottom:4},result:{gap:14},warningToggle:{flexDirection:'row',alignItems:'center',gap:10,padding:12,backgroundColor:PANEL,borderRadius:12},primaryButton:{minHeight:58,backgroundColor:GOLD,borderRadius:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16},primaryText:{color:BG,fontSize:12,fontWeight:'900',letterSpacing:1,flex:1,textAlign:'center'},disabled:{opacity:.4},secondaryButton:{minHeight:46,borderWidth:1,borderColor:'#6A5431',borderRadius:12,alignItems:'center',justifyContent:'center'},reset:{alignItems:'center',padding:8},footer:{color:'#827662',fontSize:10,lineHeight:16,textAlign:'center'},error:{flexDirection:'row',gap:10,padding:12,backgroundColor:'#3A1D17',borderRadius:12},errorText:{color:'#FFB6A5',flex:1},busy:{flexDirection:'row',alignItems:'center',gap:10,padding:12}
});
