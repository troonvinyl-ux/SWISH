import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { AuthRouter, useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { isSwishMasterAdmin } from '@/contexts/AppContext';
import { Colors } from '@/constants/theme';

function PrivateOwnerMessage() {
  return (
    <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: 28, gap: 14 }}>
      <Text style={{ color: Colors.textPrimary, fontSize: 23, fontWeight: '800' }}>Private owner app</Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 15, lineHeight: 23 }}>This installation is reserved for the SWISH Master Admin account. Sign out and use the authorised owner account.</Text>
    </View>
  );
}

function MasterAdminGate() {
  const { user } = useAuth();
  const { isMasterAdmin, tenantLoading, nichePreferencesLoading, tenantError, reloadTenant } = useApp();

  if (!user) return null;
  // Reject non-owner accounts immediately. For the configured owner, wait for
  // the existing tenant/admin lookup before evaluating the server-derived flag.
  if (!isSwishMasterAdmin(user.email)) return <PrivateOwnerMessage />;

  if (tenantLoading || nichePreferencesLoading) {
    return <View style={{ flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator size="large" color={Colors.primary} /></View>;
  }

  if (tenantError) {
    return (
      <View style={{ flex: 1, backgroundColor: Colors.background, justifyContent: 'center', padding: 28, gap: 14 }}>
        <Text style={{ color: Colors.textPrimary, fontSize: 21, fontWeight: '800' }}>Account could not be loaded</Text>
        <Text style={{ color: Colors.textSecondary, fontSize: 15 }}>{tenantError}</Text>
        <Pressable onPress={() => { void reloadTenant(); }} style={{ padding: 15, backgroundColor: Colors.primary, borderRadius: 10 }}>
          <Text style={{ color: Colors.background, fontWeight: '700', textAlign: 'center' }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!isMasterAdmin) return <PrivateOwnerMessage />;
  return <Redirect href={"/master-admin" as any} />;
}

export default function MasterAdminEntry() {
  return <AuthRouter loginRoute="/login" excludeRoutes={[]}><MasterAdminGate /></AuthRouter>;
}
