import { memo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { Colors, Spacing, Radius, Typography } from '@/constants/theme';
import { useAccountLogout } from '@/hooks/useAccountLogout';

interface LogoutButtonProps { disabled?: boolean; confirmationMessage?: string }

/** A small secondary header action; existing niche branding/layout is untouched. */
export const LogoutButton = memo(function LogoutButton({ disabled = false, confirmationMessage }: LogoutButtonProps) {
  const logout = useAccountLogout({ confirmationMessage });
  const unavailable = disabled || logout.disabled;
  return (
    <Pressable
      testID="account-logout-button"
      accessibilityRole="button"
      accessibilityLabel="Log out of SWISH"
      accessibilityHint="Return to sign in with another account"
      accessibilityState={{ disabled: unavailable, busy: logout.signingOut }}
      disabled={unavailable}
      onPress={logout.requestLogout}
      style={({ pressed }) => [styles.button, pressed ? styles.pressed : null, unavailable ? styles.disabled : null]}
    >
      {logout.signingOut ? <ActivityIndicator size="small" color={Colors.textPrimary} /> : <MaterialIcons name="logout" size={22} color={Colors.textPrimary} />}
      <Text style={styles.label}>{logout.signingOut ? 'Leaving' : 'Log out'}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  button: { width: 56, minHeight: 48, paddingVertical: Spacing.xs, gap: Spacing.xs, borderRadius: Radius.lg, backgroundColor: Colors.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  label: { fontSize: Typography.size.sm, fontWeight: Typography.weight.semibold, color: Colors.textPrimary, includeFontPadding: false },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.5 },
});
