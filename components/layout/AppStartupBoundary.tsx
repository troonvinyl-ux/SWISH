import { Component, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Colors, Radius, Spacing, Typography } from '@/constants/theme';

interface AppStartupBoundaryProps { children: ReactNode }
interface StartupState { failed: boolean; attempt: number }
/** Shows recoverable render errors without signing out or changing saved user data. */
export class AppStartupBoundary extends Component<AppStartupBoundaryProps, StartupState> {
  state: StartupState = { failed: false, attempt: 0 };
  static getDerivedStateFromError() { return { failed: true }; }
  private retry = () => this.setState(previous => ({ failed: false, attempt: previous.attempt + 1 }));
  render() {
    if (!this.state.failed) return <View key={this.state.attempt} style={styles.container}>{this.props.children}</View>;
    return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <View style={styles.panel}>
        <Text style={styles.brand}>SWISH</Text>
        <Text accessibilityRole="header" style={styles.title}>SWISH could not open</Text>
        <Text accessibilityRole="alert" style={styles.body}>The app encountered a startup error. Your saved items, photos and listings have not been deleted. Retry to reopen your session.</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Retry opening SWISH without signing out" onPress={this.retry} style={({ pressed }) => [styles.button, pressed ? styles.pressed : null]}><Text style={styles.buttonText}>Retry opening SWISH</Text></Pressable>
        <Text selectable style={styles.body}>If this returns, reopen the preview from OnSpace and share this screen. Reference: STARTUP_RENDER.</Text>
      </View>
    </SafeAreaView>;
  }
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  screen: { flex: 1, justifyContent: 'center', backgroundColor: Colors.background, padding: Spacing.xl },
  panel: { width: '100%', maxWidth: 600, alignSelf: 'center', backgroundColor: Colors.surface, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.surfaceBorder, padding: Spacing.xl, gap: Spacing.base },
  brand: { color: Colors.primary, fontSize: Typography.size.md, fontWeight: Typography.weight.bold, includeFontPadding: false },
  title: { color: Colors.textPrimary, fontSize: Typography.size.lg, fontWeight: Typography.weight.bold, includeFontPadding: false },
  body: { color: Colors.textSecondary, fontSize: Typography.size.base, lineHeight: 26, includeFontPadding: false },
  button: { minHeight: 48, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary, padding: Spacing.base },
  buttonText: { color: Colors.textInverse, fontSize: Typography.size.base, fontWeight: Typography.weight.semibold, includeFontPadding: false },
  pressed: { opacity: 0.65, transform: [{ scale: 0.99 }] },
});
