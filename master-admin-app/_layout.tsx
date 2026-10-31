import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AlertProvider, AuthProvider } from '@/template';
import { AppProvider } from '@/contexts/AppContext';
import { GlobalAccountControls } from '@/components/layout/GlobalAccountControls';

/** Deliberately small route tree: the Master Admin APK is a launcher, not a
 * second copy of every niche workspace. Niche products open as separate APKs. */
export default function MasterAdminRootLayout() {
  return (
    <AlertProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <AppProvider>
            <Stack screenOptions={{ headerShown: false }} />
            <GlobalAccountControls />
          </AppProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
