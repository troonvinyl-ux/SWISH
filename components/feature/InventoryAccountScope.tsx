import { memo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useAuth } from '@/template';
import { useApp } from '@/hooks/useApp';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { Colors, Spacing, Typography, Radius } from '@/constants/theme';

// Exported contract is included in the unified source tree; no separate account lookup.
export interface InventoryAccountScopeProps { total?: number; verified?: boolean; error?: string | null }
/** Shows only the signed-in identity and authorised workspace; never searches other accounts. */
export const InventoryAccountScope = memo(function InventoryAccountScope({ total, verified = false, error }: InventoryAccountScopeProps) {
  const { user } = useAuth();
  const { tenant, activeNiche, accessReady, moduleLoading, subscriptionLoading } = useApp();
  const available = verified && accessReady && !moduleLoading && !subscriptionLoading && !error;
  return <View testID="inventory-account-scope" style={s.card}>
    <View style={s.row}><MaterialIcons name="account-circle" size={24} color={activeNiche.color}/><View style={s.flex}>
      <Text selectable style={s.name}>{user?.email ?? 'Sign in required'}</Text>
      <Text style={s.body}>{tenant?.name ?? 'Verifying workspace'} · {activeNiche.shortName}</Text>
    </View><LogoutButton confirmationMessage="Sign out to use the account that owns your existing inventory. Original inventory, photographs, valuations and eBay connections remain in their existing tenant; nothing is copied or disconnected."/></View>
    {tenant?.id ? <Text selectable style={s.reference}>Workspace ID: {tenant.id}</Text> : null}
    {available && total !== undefined ? <Text style={s.body}>{total} authorised {activeNiche.terms.items.toLowerCase()} across all inventory states.</Text> : null}
    {available && total === 0 ? <Text style={s.body}>No records were returned for this account and workspace. If your collection was saved using another account, sign out and sign in with that account. Switching niche does not switch the owner or tenant.</Text> : null}
    {error ? <Text accessibilityRole="alert" style={s.error}>Inventory is not verified: {error}</Text> : null}
  </View>;
});
const s = StyleSheet.create({
  card: { padding: Spacing.base, gap: Spacing.sm, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.surfaceBorder, borderRadius: Radius.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm }, flex: { flex: 1 },
  name: { fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, includeFontPadding: false },
  body: { fontSize: Typography.size.base, color: Colors.textSecondary, lineHeight: 26 },
  reference: { fontSize: Typography.size.sm, color: Colors.textSecondary, lineHeight: 22 },
  error: { fontSize: Typography.size.base, color: Colors.warning, lineHeight: 26 },
});
