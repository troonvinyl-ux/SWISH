// Shared selling workspace. Tools keep the active module's existing route permissions.
import { View,Text,StyleSheet,Pressable,FlatList } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors,Typography,Spacing,Radius } from '@/constants/theme';
import { PremiumStyles } from '@/constants/styles';
import { useApp } from '@/hooks/useApp';
import { useArtworkLayout } from '@/hooks/useArtworkLayout';
import { isRouteAllowedForBuild } from '@/services/nicheRouting';
const tools=[
 {icon:'storefront',label:'eBay hub',detail:'Your selling overview',route:'/ebay-hub'},
 {icon:'receipt-long',label:'Orders',detail:'Pack and dispatch',route:'/orders'},
 {icon:'chat-bubble-outline',label:'Messages',detail:'Buyer conversations',route:'/ebay-messages'},
 {icon:'local-offer',label:'Offers',detail:'Review buyer offers',route:'/ebay-offers'},
 {icon:'analytics',label:'Analytics',detail:'Views, watchers and sales',route:'/ebay-analytics'},
 {icon:'payments',label:'Finances',detail:'Payouts and fees',route:'/ebay-finances'},
 {icon:'travel-explore',label:'Research',detail:'Niche-specific comparables',route:'/research'},
 {icon:'assignment-return',label:'Returns',detail:'Resolve buyer returns',route:'/ebay-returns'},
 {icon:'gavel',label:'Cases',detail:'Handle open disputes',route:'/ebay-cases'},
 {icon:'price-change',label:'Repricing',detail:'Review your pricing rules',route:'/repricing'},
 {icon:'upload-file',label:'CSV import',detail:'Import marketplace records',route:'/ebay-csv'},
 {icon:'account-circle',label:'eBay account',detail:'Connection and policies',route:'/ebay-account'},
];
export default function ListingsTabScreen(){
 const router=useRouter();const {activeNiche,activeNicheId,fixedNicheId}=useApp();const {columns}=useArtworkLayout();const accent=activeNiche.color;const visible=tools.filter(tool=>isRouteAllowedForBuild(tool.route,fixedNicheId??activeNicheId));
 return <SafeAreaView edges={['top']} style={s.screen}><StatusBar style="light"/><View style={s.header}><View style={[s.brand,{backgroundColor:accent+'18'}]}><MaterialIcons name="storefront" size={24} color={accent}/></View><View><Text style={s.title}>Listings</Text><Text style={s.caption}>{activeNiche.shortName} · selling workspace</Text></View></View>
 <FlatList key={columns} numColumns={columns} data={visible} keyExtractor={tool=>tool.route} showsVerticalScrollIndicator={false} contentContainerStyle={PremiumStyles.content} columnWrapperStyle={columns>1?s.columns:undefined} ListHeaderComponent={<View style={s.intro}><View style={[s.hero,{borderColor:accent+'40'}]}><Text style={[s.eyebrow,{color:accent}]}>STOCK → DRAFT → LIVE → SOLD</Text><Text style={s.heroTitle}>A clear path from item to sale.</Text><Text style={s.body}>Prepare your drafts, review clean photos and keep your live listings in order.</Text><Pressable onPress={()=>router.replace('/(tabs)/inventory' as any)} style={({pressed})=>[s.primary,{backgroundColor:accent},pressed?PremiumStyles.pressed:null]}><MaterialIcons name="inventory-2" size={20} color={Colors.textInverse}/><Text style={s.primaryText}>Manage inventory & listings</Text></Pressable></View><Text style={s.section}>Selling tools</Text></View>} renderItem={({item})=><Pressable onPress={()=>router.push(item.route as any)} style={({pressed})=>[PremiumStyles.card,s.tool,columns>1?s.gridTool:null,pressed?PremiumStyles.pressed:null]}><View style={[s.icon,{backgroundColor:accent+'18'}]}><MaterialIcons name={item.icon as any} size={24} color={accent}/></View><View style={s.flex}><Text style={s.toolTitle}>{item.label}</Text><Text style={s.caption}>{item.detail}</Text></View><MaterialIcons name="chevron-right" size={22} color={accent}/></Pressable>}/></SafeAreaView>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:Colors.background},header:{padding:Spacing.base,flexDirection:'row',gap:Spacing.md,alignItems:'center'},brand:{width:48,height:48,borderRadius:Radius.md,alignItems:'center',justifyContent:'center'},title:{fontSize:Typography.size.lg,fontWeight:Typography.weight.bold,color:Colors.textPrimary},caption:{fontSize:Typography.size.sm,color:Colors.textSecondary,lineHeight:21},intro:{gap:Spacing.xl,marginBottom:Spacing.base},hero:{padding:Spacing.xl,gap:Spacing.md,borderRadius:Radius.xxl,borderWidth:1,backgroundColor:Colors.primaryDim},eyebrow:{fontSize:Typography.size.xs,fontWeight:Typography.weight.bold,letterSpacing:1},heroTitle:{fontSize:Typography.size.xl,fontWeight:Typography.weight.bold,color:Colors.textPrimary,lineHeight:31},body:{fontSize:Typography.size.base,color:Colors.textSecondary,lineHeight:26},primary:{minHeight:52,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:Spacing.sm,padding:Spacing.md,borderRadius:Radius.lg},primaryText:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textInverse},section:{fontSize:Typography.size.md,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},tool:{flexDirection:'row',alignItems:'center',minHeight:96,marginBottom:Spacing.md},gridTool:{flex:1},columns:{gap:Spacing.md},icon:{width:48,height:48,borderRadius:Radius.md,alignItems:'center',justifyContent:'center'},toolTitle:{fontSize:Typography.size.base,fontWeight:Typography.weight.semibold,color:Colors.textPrimary},flex:{flex:1}});
