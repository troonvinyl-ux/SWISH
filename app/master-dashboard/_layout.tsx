import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AlertProvider, AuthProvider } from '@/template';
import { AppProvider } from '@/contexts/AppContext';
import { StatusBar } from 'expo-status-bar';
import * as NavigationBar from 'expo-navigation-bar';
import { Platform } from 'react-native';

export default function MasterDashboardLayout() {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    void NavigationBar.setVisibilityAsync('hidden').catch(() => {});
    void NavigationBar.setBehaviorAsync('overlay-swipe').catch(() => {});
  }, []);

  return (
    <AlertProvider>
      <SafeAreaProvider>
        <AuthProvider>
          <AppProvider>
            <StatusBar hidden />
            <Stack screenOptions={{ headerShown: false, animation: 'fade', contentStyle: { backgroundColor: '#080B10' } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="control" />
              <Stack.Screen name="shops" />
              <Stack.Screen name="login" />
            </Stack>
          </AppProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </AlertProvider>
  );
}
