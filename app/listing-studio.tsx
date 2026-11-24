import { useLocalSearchParams } from 'expo-router';
import { ListingStudioWorkspace } from '@/components/feature/ListingStudioWorkspace';
export default function ListingStudioScreen(){const {global}=useLocalSearchParams<{global?:string}>();return <ListingStudioWorkspace global={global==='1'}/>;}
