// One smooth, layered Stage material for every shared SWISH workspace.
import { StyleSheet } from 'react-native';
import { Colors, Spacing, Radius, Typography, Shadow } from './theme';
export const PremiumStyles=StyleSheet.create({
 card:{backgroundColor:Colors.surfaceElevated,borderRadius:Radius.xl,borderWidth:1,borderColor:Colors.surfaceBorder,padding:Spacing.base,gap:Spacing.md,...Shadow.sm},
 title:{fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,color:Colors.textPrimary,includeFontPadding:false},
 body:{fontSize:Typography.size.base,lineHeight:26,color:Colors.textSecondary,includeFontPadding:false},
 input:{minHeight:48,borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight,borderWidth:1,borderColor:Colors.surfaceBorder,padding:Spacing.md,fontSize:Typography.size.base,color:Colors.textPrimary,includeFontPadding:false},
 iconButton:{minWidth:48,minHeight:48,alignItems:'center',justifyContent:'center',borderRadius:Radius.md,backgroundColor:Colors.surfaceHighlight},
 content:{padding:Spacing.base,gap:Spacing.base,width:'100%',maxWidth:960,alignSelf:'center'},
 pressed:{opacity:0.7,transform:[{scale:0.985}]},
});
