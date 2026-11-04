// Legacy selector URL now uses verified memberships; no local bookmarks grant access.
import { Redirect } from 'expo-router';
export default function NicheSelectScreen() { return <Redirect href={'/swish' as any} />; }
