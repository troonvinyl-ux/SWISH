// Redirect standalone /listings route to the tab
import { Redirect } from 'expo-router';

export default function ListingsRedirect() {
  return <Redirect href={'/(tabs)/listings' as any} />;
}
