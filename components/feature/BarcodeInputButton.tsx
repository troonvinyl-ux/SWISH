import { memo,useState } from 'react';
import { Pressable,Text,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { SharedBarcodeScanner } from './SharedBarcodeScanner';
import { Colors,Spacing,Radius,Typography } from '@/constants/theme';
interface BarcodeInputButtonProps {onValue:(code:string)=>void;disabled?:boolean;label?:string}
export const BarcodeInputButton=memo(function BarcodeInputButton({onValue,disabled=false,label='Scan barcode'}:BarcodeInputButtonProps){const [open,setOpen]=useState(false);return <><Pressable disabled={disabled} accessibilityLabel={label} onPress={()=>setOpen(true)} style={({pressed})=>[s.button,pressed||disabled?s.pressed:null]}><MaterialIcons name="qr-code-scanner" size={22} color={Colors.primary}/><Text style={s.text}>{label}</Text></Pressable>{open?<SharedBarcodeScanner title={label} onClose={()=>setOpen(false)} onValue={code=>{setOpen(false);onValue(code);}}/>:null}</>;});
const s=StyleSheet.create({button:{minHeight:48,padding:Spacing.sm,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.sm},text:{fontSize:Typography.size.base,color:Colors.primary,fontWeight:Typography.weight.medium},pressed:{opacity:0.6}});
