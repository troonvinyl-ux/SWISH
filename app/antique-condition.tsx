// Reuse the canonical specialist editor rather than a second condition persistence path.
import { Redirect, useLocalSearchParams } from 'expo-router';
export default function AntiqueConditionScreen(){
 const {id}=useLocalSearchParams<{id?:string}>();
 return <Redirect href={(id ? `/stock-listing/${encodeURIComponent(id)}` : '/(tabs)/inventory') as any}/>;
}
