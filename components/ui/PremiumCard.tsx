import { memo, useState, type ReactNode, type ComponentProps } from 'react';
import { View,Text,Pressable,StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
import { PremiumStyles } from '@/constants/styles';
interface PremiumCardProps {title:string;summary?:string;accent:string;icon?:ComponentProps<typeof MaterialIcons>['name'];collapsible?:boolean;defaultOpen?:boolean;children:ReactNode;action?:ReactNode}
export const PremiumCard=memo(function PremiumCard({title,summary,accent,icon,collapsible=false,defaultOpen=true,children,action}:PremiumCardProps){
 const [open,setOpen]=useState(defaultOpen);
 return <View style={PremiumStyles.card}>
  <View style={s.header}><Pressable disabled={!collapsible} accessibilityRole={collapsible?'button':undefined} accessibilityState={collapsible?{expanded:open}:undefined} onPress={()=>setOpen(value=>!value)} style={({pressed})=>[s.heading,pressed?PremiumStyles.pressed:null]}>
   {icon?<View style={[s.icon,{backgroundColor:accent+'18'}]}><MaterialIcons name={icon} size={22} color={accent}/></View>:null}
   <View style={s.flex}><Text style={PremiumStyles.title}>{title}</Text>{summary?<Text numberOfLines={2} style={s.summary}>{summary}</Text>:null}</View>
   {collapsible?<MaterialIcons name={open?'expand-less':'expand-more'} size={22} color={accent}/>:null}
  </Pressable>{action??null}</View>
  {!collapsible||open?<View style={s.body}>{children}</View>:null}
 </View>;
});
const s=StyleSheet.create({header:{flexDirection:'row',alignItems:'center',gap:Spacing.sm},heading:{flex:1,flexDirection:'row',alignItems:'center',gap:Spacing.md,minHeight:48},flex:{flex:1},icon:{width:40,height:40,borderRadius:Radius.md,alignItems:'center',justifyContent:'center'},summary:{fontSize:Typography.size.sm,color:Colors.textSecondary,lineHeight:20,marginTop:Spacing.xs},body:{gap:Spacing.md}});
