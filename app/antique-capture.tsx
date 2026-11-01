import React, { useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import type { CameraCapturedPicture } from 'expo-camera';
import { useGenericCapture } from '@/hooks/useGenericCapture';
import { useApp } from '@/hooks/useApp';
import { SpecialistReview } from '@/components/feature/SpecialistReview';
import { PhotoQualityReview } from '@/components/feature/PhotoQualityReview';
import { FlipIntelligencePanel } from '@/components/feature/FlipIntelligencePanel';

const GOLD = '#F4C64E';
const BG = '#050607';
const PANEL = '#111315';
const MUTED = '#C5C7C9';

export default function AntiqueCaptureScreen() {
  const capture = useGenericCapture();
  const router = useRouter();
  const { tenant } = useApp();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<'back'|'front'>('back');
  const [activeSlot, setActiveSlot] = useState('');
  const [cameraReady, setCameraReady] = useState(false);
  const [mode, setMode] = useState<'photo'|'video'>('photo');
  const [cameraError, setCameraError] = useState('');
  const camera = useRef<CameraView>(null);
  const { width } = useWindowDimensions();
  const selectedSlot = capture.slots.find(slot => slot.id === activeSlot) ?? capture.slots.find(slot => !capture.images.some(image => image.slotId === slot.id)) ?? capture.slots[0];
  const activeImage = capture.images.find(image => image.slotId === selectedSlot?.id);
  const complete = capture.slots.filter(slot => capture.images.some(image => image.slotId === slot.id)).length;
  const frameHeight = Math.max(330, Math.min(510, width * 1.28));

  const takePhoto = async () => {
    if (mode === 'video') {
      setCameraError('Video is a viewing aid only at the moment. Switch to PHOTO to add evidence to the identification.');
      return;
    }
    if (!selectedSlot) return;
    try {
      if (!permission?.granted) {
        const result = await requestPermission();
        if (!result.granted) { setCameraError('Camera permission is needed to photograph this antique.'); return; }
      }
      if (!cameraReady || !camera.current) { setCameraError('Camera is still starting. Please try again in a moment.'); return; }
      setCameraError('');
      const picture: CameraCapturedPicture | undefined = await camera.current.takePictureAsync({ quality: 0.88, skipProcessing: false });
      if (picture?.uri) {
        await capture.addCapturedPhoto(selectedSlot.id, { uri: picture.uri, width: picture.width, height: picture.height });
        const next = capture.slots.find(slot => slot.id !== selectedSlot.id && !capture.images.some(image => image.slotId === slot.id));
        if (next) setActiveSlot(next.id);
      }
    } catch (error: any) {
      setCameraError(error?.message ?? 'The photo could not be captured. Please try again.');
    }
  };

  return (
    <SafeAreaView edges={['top','bottom']} style={s.screen}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Pressable accessibilityLabel="Close scanner" onPress={() => router.back()} style={s.headerButton}><MaterialIcons name="close" size={27} color="#FFFFFF" /></Pressable>
        <View style={s.headerCenter}><Text style={s.brand}>ANTIQUE FLIPPER</Text><Text style={s.headerSub}>OBJECT SCANNER</Text></View>
        <Pressable accessibilityLabel="View capture guide" onPress={() => setCameraError('Capture each angle in turn: full view, reverse, base, maker marks and details.')} style={s.headerButton}><MaterialIcons name="grid-view" size={23} color="#FFFFFF" /></Pressable>
      </View>

      <View style={[s.cameraStage,{height:frameHeight}]}>
        {activeImage ? (
          <Image source={{uri:activeImage.uri}} contentFit="contain" style={StyleSheet.absoluteFill} />
        ) : permission?.granted ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing={facing} mode="picture" onCameraReady={() => setCameraReady(true)} onMountError={event => setCameraError(event.message)} />
        ) : (
          <Pressable onPress={() => { void requestPermission(); }} style={s.permission}>
            <MaterialIcons name="photo-camera" size={48} color={GOLD} />
            <Text style={s.permissionTitle}>Allow camera access</Text>
            <Text style={s.permissionText}>Use the live scanner to photograph your antique from multiple angles.</Text>
          </Pressable>
        )}
        <View pointerEvents="none" style={s.frame}>
          <View style={[s.corner,s.tl]} /><View style={[s.corner,s.tr]} />
          <View style={[s.corner,s.bl]} /><View style={[s.corner,s.br]} />
        </View>
        <View style={s.livePill}><View style={s.liveDot}/><Text style={s.liveText}>{activeImage ? 'CAPTURED VIEW' : 'LIVE CAMERA'}</Text></View>
        <View style={s.anglePill}><Text style={s.angleText}>{selectedSlot?.label ?? 'Object view'}</Text></View>
        {activeImage ? <Pressable onPress={() => setActiveSlot(selectedSlot.id)} style={s.retake}><MaterialIcons name="refresh" size={17} color="#FFFFFF"/><Text style={s.retakeText}>RETAKE THIS ANGLE</Text></Pressable> : null}
      </View>

      <View style={s.instruction}><Text style={s.instructionTitle}>Take clear photos from multiple angles</Text><Text style={s.instructionSub}>{complete} of {capture.slots.length} views captured · {selectedSlot?.description ?? 'Show the whole object clearly'}</Text></View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.thumbnails}>
        {capture.slots.map((slot,index) => {
          const image = capture.images.find(item => item.slotId === slot.id);
          const selected = slot.id === selectedSlot?.id;
          return <Pressable key={slot.id} onPress={() => { setActiveSlot(slot.id); setCameraReady(false); }} style={[s.thumb,selected && s.thumbSelected]}>
            {image ? <Image source={{uri:image.uri}} contentFit="cover" style={s.thumbImage}/> : <View style={s.thumbEmpty}><MaterialIcons name="photo-camera" size={21} color={GOLD}/></View>}
            <View style={s.thumbNumber}><Text style={s.thumbNumberText}>{index+1}</Text></View>
            {image ? <View style={s.thumbCheck}><MaterialIcons name="check" size={12} color={BG}/></View> : null}
          </Pressable>;
        })}
      </ScrollView>

      <View style={s.controls}>
        <Pressable accessibilityLabel="Choose photo from gallery" onPress={() => selectedSlot && void capture.capture(selectedSlot.id,true)} style={s.sideControl}><MaterialIcons name="photo-library" size={27} color="#FFFFFF"/><Text style={s.controlLabel}>GALLERY</Text></Pressable>
        <Pressable accessibilityLabel="Take photo" disabled={capture.busy} onPress={() => void takePhoto()} style={s.shutterOuter}><View style={s.shutter}/></Pressable>
        <Pressable accessibilityLabel="Switch camera" onPress={() => { setFacing(current => current === 'back' ? 'front' : 'back'); setCameraReady(false); }} style={s.sideControl}><MaterialIcons name="flip-camera-android" size={27} color="#FFFFFF"/><Text style={s.controlLabel}>FLIP</Text></Pressable>
      </View>
      <View style={s.modeSwitch}>
        <Pressable onPress={() => { setMode('photo'); setCameraError(''); }} style={[s.modeButton,mode==='photo' && s.modeActive]}><Text style={[s.modeText,mode==='photo' && s.modeTextActive]}>PHOTO</Text></Pressable>
        <Pressable onPress={() => setMode('video')} style={[s.modeButton,mode==='video' && s.modeActive]}><Text style={[s.modeText,mode==='video' && s.modeTextActive]}>VIDEO</Text></Pressable>
      </View>

      {cameraError ? <Text style={s.error}>{cameraError}</Text> : null}
      {capture.error ? <Text style={s.error}>{capture.error}</Text> : null}
      {capture.busy ? <View style={s.busy}><ActivityIndicator color={GOLD}/><Text style={s.busyText}>{capture.phase || 'Preparing photo…'}</Text></View> : null}

      {capture.images.length > 0 ? (
        <View style={s.bottomAction}>
          {capture.result ? <SpecialistReview result={capture.result} profile={capture.profile} answers={capture.answers} disabled={capture.busy || Boolean(capture.savedId)} onAnswer={capture.answer} onTitle={capture.correctTitle}/> : null}
          {capture.result ? <FlipIntelligencePanel key={capture.specialistId} result={capture.result} nicheId={capture.activeNiche.id} tenantId={tenant?.id}/> : null}
          {activeImage?.photoQuality ? <PhotoQualityReview quality={activeImage.photoQuality}/> : null}
          <Pressable disabled={capture.busy || !capture.images.length || (Boolean(capture.result) && !capture.result?.canonicalTitle.trim())} onPress={() => { if(capture.savedId) router.push('/stock-listing/'+capture.savedId as any); else if(capture.result) void capture.save(); else void capture.identify(); }} style={s.identifyButton}>
            <MaterialIcons name={capture.savedId ? 'inventory' : capture.result ? 'save' : 'auto-awesome'} size={20} color={BG}/>
            <Text style={s.identifyText}>{capture.savedId ? 'VIEW SAVED ITEM' : capture.result ? 'SAVE TO ANTIQUE INVENTORY' : 'IDENTIFY ANTIQUE'}</Text>
            <MaterialIcons name="arrow-forward" size={20} color={BG}/>
          </Pressable>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:{flex:1,backgroundColor:BG},
  header:{height:58,paddingHorizontal:14,flexDirection:'row',alignItems:'center',justifyContent:'space-between',backgroundColor:'#090A0B'},
  headerButton:{width:42,height:42,alignItems:'center',justifyContent:'center'},
  headerCenter:{alignItems:'center',gap:2},brand:{color:'#FFFFFF',fontSize:12,fontWeight:'900',letterSpacing:2},headerSub:{color:GOLD,fontSize:8,fontWeight:'800',letterSpacing:2},
  cameraStage:{width:'100%',backgroundColor:'#241D16',overflow:'hidden',justifyContent:'center',alignItems:'center'},
  frame:{...StyleSheet.absoluteFillObject,margin:22},
  corner:{position:'absolute',width:42,height:42,borderColor:'#FFFFFF',opacity:0.95},
  tl:{top:0,left:0,borderTopWidth:2,borderLeftWidth:2},tr:{top:0,right:0,borderTopWidth:2,borderRightWidth:2},bl:{bottom:0,left:0,borderBottomWidth:2,borderLeftWidth:2},br:{bottom:0,right:0,borderBottomWidth:2,borderRightWidth:2},
  livePill:{position:'absolute',top:13,left:14,backgroundColor:'#0009',borderRadius:20,paddingHorizontal:10,paddingVertical:7,flexDirection:'row',alignItems:'center',gap:7},
  liveDot:{width:6,height:6,borderRadius:5,backgroundColor:'#68D391'},liveText:{color:'#FFFFFF',fontSize:9,fontWeight:'900',letterSpacing:1},
  anglePill:{position:'absolute',bottom:14,left:14,right:14,alignItems:'center'},angleText:{color:'#FFFFFF',fontSize:12,fontWeight:'800',backgroundColor:'#0009',overflow:'hidden',paddingHorizontal:12,paddingVertical:7,borderRadius:16},
  permission:{alignItems:'center',padding:28,gap:12},permissionTitle:{color:'#FFFFFF',fontSize:18,fontWeight:'900'},permissionText:{color:MUTED,fontSize:12,textAlign:'center',lineHeight:18},
  retake:{position:'absolute',bottom:14,right:14,backgroundColor:'#000B',borderRadius:18,paddingHorizontal:10,paddingVertical:8,flexDirection:'row',gap:5,alignItems:'center'},retakeText:{color:'#FFFFFF',fontSize:9,fontWeight:'900'},
  instruction:{paddingHorizontal:17,paddingTop:12,paddingBottom:6,gap:4},instructionTitle:{color:'#FFFFFF',fontSize:13,fontWeight:'800'},instructionSub:{color:MUTED,fontSize:10,lineHeight:15},
  thumbnails:{paddingHorizontal:13,paddingVertical:8,gap:8,alignItems:'center'},
  thumb:{width:53,height:59,borderRadius:8,borderWidth:1,borderColor:'#6C7378',overflow:'hidden',backgroundColor:PANEL},thumbSelected:{borderWidth:2,borderColor:GOLD},
  thumbImage:{width:'100%',height:'100%'},thumbEmpty:{flex:1,alignItems:'center',justifyContent:'center'},thumbNumber:{position:'absolute',left:3,top:3,backgroundColor:'#0009',borderRadius:8,paddingHorizontal:5,paddingVertical:1},thumbNumberText:{color:'#FFFFFF',fontSize:8,fontWeight:'900'},thumbCheck:{position:'absolute',right:3,bottom:3,width:16,height:16,borderRadius:8,backgroundColor:GOLD,alignItems:'center',justifyContent:'center'},
  controls:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingTop:9,paddingBottom:3},
  sideControl:{width:65,height:54,alignItems:'center',justifyContent:'center',gap:3},controlLabel:{color:'#D7D9DA',fontSize:8,fontWeight:'800',letterSpacing:1},
  shutterOuter:{width:70,height:70,borderRadius:36,borderWidth:2,borderColor:'#FFFFFF',alignItems:'center',justifyContent:'center'},shutter:{width:57,height:57,borderRadius:30,backgroundColor:GOLD,borderWidth:2,borderColor:'#FFF1B8'},
  modeSwitch:{flexDirection:'row',justifyContent:'center',gap:30,paddingTop:2,paddingBottom:8},modeButton:{paddingHorizontal:12,paddingVertical:5,borderBottomWidth:2,borderBottomColor:'transparent'},modeActive:{borderBottomColor:GOLD},modeText:{color:'#9CA3A9',fontSize:10,letterSpacing:1},modeTextActive:{color:'#FFFFFF',fontWeight:'900'},
  error:{color:'#FFB4A8',fontSize:11,textAlign:'center',paddingHorizontal:14,paddingVertical:4},busy:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,padding:7},busyText:{color:MUTED,fontSize:11},
  bottomAction:{paddingHorizontal:14,paddingBottom:8,gap:8,maxHeight:220},identifyButton:{minHeight:48,backgroundColor:GOLD,borderRadius:13,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:14},identifyText:{color:BG,fontSize:11,fontWeight:'900',letterSpacing:.7,flex:1,textAlign:'center'}
});
