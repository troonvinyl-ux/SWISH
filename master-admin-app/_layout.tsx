// Private launcher presentation layer. Reuses SWISH's canonical providers and backend.
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { MaterialIcons } from '@expo/vector-icons';
import * as SplashScreen from 'expo-splash-screen';
import { AlertProvider, AuthProvider } from '@/template';
import { AppProvider } from '@/contexts/AppContext';

export default function MasterAdminRootLayout() {
  useFonts(MaterialIcons.font);
  useEffect(() => { void SplashScreen.hideAsync().catch(() => { /* Host may already have hidden the splash. */ }); }, []);
  return <AlertProvider><SafeAreaProvider><AuthProvider><AppProvider>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index"/>
      <Stack.Screen name="login"/>
      <Stack.Screen name="master-admin"/>
      <Stack.Screen name="production-control"/>
      <Stack.Screen name="master-diagnostics"/>
      <Stack.Screen name="privacy-policy"/>
    </Stack>
  </AppProvider></AuthProvider></SafeAreaProvider></AlertProvider>;
}
