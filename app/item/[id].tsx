// SWISH — Legacy item route redirect
// All item detail views now use the canonical /stock-listing/[id] screen.
// This file redirects any legacy /item/[id] navigation to the correct route.

import { useLocalSearchParams, Redirect } from 'expo-router';

export default function LegacyItemRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return null;
  return <Redirect href={`/stock-listing/${id}` as any} />;
}
