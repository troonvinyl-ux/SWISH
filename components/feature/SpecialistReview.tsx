import { memo } from 'react';
import { View,Text,TextInput,Pressable,StyleSheet,Linking } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import type { AIIdentificationResult } from '@/services/aiIdentificationService';
import type { SpecialistProfile } from '@/shared/specialistIntelligence';
import { Colors,Spacing,Typography,Radius } from '@/constants/theme';
interface SpecialistReviewProps { result:AIIdentificationResult; profile:SpecialistProfile|null; answers:Record<string,string>; disabled:boolean; onAnswer:(key:string,value:string)=>void; onTitle:(value:string)=>void }
export const SpecialistReview=memo(function SpecialistReview({ result,profile,answers,disabled,onAnswer,onTitle }:SpecialistReviewProps) {
  const analysis=result.specialistAnalysis;
  return <View style={s.card}>
    <View style={s.row}><MaterialIcons name="fact-check" size={24} color={Colors.primary}/><Text style={s.title}>Review the evidence</Text></View>
    <Text style={s.body}>AI proposal, not a verified identification. Saving does not publish a listing.</Text>
    <Text style={s.label}>Item title · edit before saving</Text>
    <TextInput accessibilityLabel="Review item title" value={result.canonicalTitle} onChangeText={onTitle} editable={!disabled} style={s.input} multiline maxLength={300}/>
    <Text style={s.body}>{Math.round(result.confidence*100)}% identification confidence · {result.identificationState ?? 'provisional'}</Text>
    {result.confidenceReason ? <Text style={s.body}>{result.confidenceReason}</Text> : null}
    <Text style={s.body}>{result.condition || 'Condition has not been established.'}</Text>
    {analysis ? <>
      <Text style={s.label}>Independent confidence dimensions</Text>
      <Text style={s.body}>Variant: {analysis.confidence.variant==null ? 'unknown' : Math.round(analysis.confidence.variant*100)+'% model assessment'}{ '\n' }Condition: {analysis.confidence.condition==null ? 'unknown' : Math.round(analysis.confidence.condition*100)+'% model assessment'}{ '\n' }Authenticity: not verified{ '\n' }Fitment: not verified{ '\n' }Valuation: separate research required</Text>
      <View style={s.quality}><Text style={s.label}>Photo assessment · {analysis.quality.status.replace(/_/g,' ')}</Text>
        {analysis.quality.issues.map((issue,index)=><Text style={s.body} key={index}>{issue}</Text>)}
        {analysis.quality.nextPhoto ? <Text style={s.body}>Next useful image: {analysis.quality.nextPhoto}</Text> : null}
      </View>
      {profile?.fields.filter(f=>analysis.fields[f.key]).map(f=><View key={f.key} style={s.field}>
        <Text style={s.label}>{f.label} · {analysis.fields[f.key].basis.replace(/_/g,' ')}</Text>
        <TextInput accessibilityLabel={`Correct ${f.label}`} style={s.input} value={answers[f.key] ?? analysis.fields[f.key].value} onChangeText={value=>onAnswer(f.key,value)} editable={!disabled} maxLength={500}/>
        {analysis.fields[f.key].reason ? <Text style={s.body}>{analysis.fields[f.key].reason}</Text> : null}
      </View>)}
      {analysis.followUps.length ? <Text style={s.title}>What would improve this result?</Text> : null}
      {analysis.followUps.map(question=><View key={question.key} style={s.field}>
        <Text style={s.label}>{question.question}</Text><Text style={s.body}>{question.reason}</Text>
        {question.photo ? <Text style={s.body}>Photograph: {question.photo}</Text> : null}
        <TextInput accessibilityLabel={question.question} style={s.input} value={answers[question.key] ?? ''} onChangeText={value=>onAnswer(question.key,value)} editable={!disabled} placeholder="Enter what you can verify" placeholderTextColor={Colors.textSecondary} maxLength={500}/>
      </View>)}
    </> : <Text style={s.body}>Detailed specialist analysis was not returned by the backend. Retry after the updated function is available; unknown dimensions are not filled in.</Text>}
    {result.candidateIdentification?.alternativeCandidates?.length ? <><Text style={s.label}>Alternative candidates</Text>{result.candidateIdentification.alternativeCandidates.map((candidate,index)=><Text style={s.body} key={index}>{typeof candidate==='string' ? candidate : 'Candidate requires further review'}</Text>)}</> : null}
    <Text style={s.label}>Supporting observations</Text>
    {result.evidenceSupporting.slice(0,6).map((text,index)=><Text key={index} style={s.body}>{text}</Text>)}
    {[...result.evidenceContradictory,...result.missingInformation,...result.warnings,...(analysis?.risks ?? [])].slice(0,12).map((text,index)=><View key={index} style={s.row}><MaterialIcons name="info-outline" size={18} color={Colors.warning}/><Text style={[s.body,s.flex]}>{text}</Text></View>)}
    {profile ? <><Text style={s.label}>Specialist verification destinations</Text><Text style={s.body}>These are reference links, not sources automatically consulted for this item.</Text>{profile.sources.map(source=><Pressable key={source.url} onPress={()=>{ void Linking.openURL(source.url); }} style={({ pressed })=>[s.link,pressed ? s.pressed : null]} accessibilityRole="link"><Text style={s.linkText}>{source.label}</Text><MaterialIcons name="open-in-new" size={18} color={Colors.info}/></Pressable>)}</> : null}
  </View>;
});
const s=StyleSheet.create({ card:{ padding:Spacing.base,borderRadius:Radius.lg,backgroundColor:Colors.surface,gap:Spacing.md,borderWidth:1,borderColor:Colors.surfaceBorder },title:{ color:Colors.textPrimary,fontSize:Typography.size.lg,fontWeight:Typography.weight.bold },body:{ color:Colors.textSecondary,fontSize:Typography.size.base,lineHeight:26,includeFontPadding:false },label:{ color:Colors.textPrimary,fontSize:Typography.size.base,fontWeight:Typography.weight.semibold },input:{ minHeight:48,borderWidth:1,borderColor:Colors.info,borderRadius:Radius.md,padding:Spacing.md,backgroundColor:Colors.surfaceHighlight,color:Colors.textPrimary,fontSize:Typography.size.base,includeFontPadding:false },row:{ flexDirection:'row',gap:Spacing.sm,alignItems:'flex-start' },flex:{ flex:1 },field:{ gap:Spacing.sm },quality:{ backgroundColor:Colors.infoDim,padding:Spacing.md,borderRadius:Radius.md,gap:Spacing.sm },link:{ minHeight:48,flexDirection:'row',justifyContent:'space-between',alignItems:'center',gap:Spacing.md },linkText:{ color:Colors.info,fontSize:Typography.size.base,flex:1 },pressed:{ opacity:0.7 } });
