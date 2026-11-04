// @ts-nocheck
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Redirect, usePathname } from 'expo-router';
import { useAuth } from './hook';

const DefaultLoadingScreen = () => (
  <View style={styles.defaultContainer}>
    <Text style={styles.defaultText}>Loading...</Text>
  </View>
);

interface AuthRouterProps {
  children: React.ReactNode;
  loginRoute?: string;
  loadingComponent?: React.ComponentType;
  excludeRoutes?: string[];
}

export function AuthRouter({
  children,
  loginRoute = '/login',
  loadingComponent: LoadingComponent = DefaultLoadingScreen,
  excludeRoutes = []
}: AuthRouterProps) {
  const { user, loading, initialized } = useAuth();
  const pathname = usePathname();

  if (loading || !initialized || !pathname) {
    return <LoadingComponent />;
  }

  const isLoginRoute = pathname === loginRoute;
  const isExcludedRoute = excludeRoutes.some((route) =>
    pathname.startsWith(route)
  );

  if (!user && !isLoginRoute && !isExcludedRoute) {
    return <Redirect href={loginRoute as any} />;
  }
  if (user && isLoginRoute) {
    return <Redirect href={'/' as any} />;
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  defaultContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
  },
  defaultText: {
    fontSize: 18,
    color: '#6B7280',
  },
});
