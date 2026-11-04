import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppUpdatePanel } from '@/components/feature/AppUpdatePanel';
import { Colors, Spacing } from '@/constants/theme';
export default function AppUpdatesScreen() { return <SafeAreaView edges={['top', 'bottom']} style={styles.screen}><ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><AppUpdatePanel /></ScrollView></SafeAreaView>; }
const styles = StyleSheet.create({ screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: Spacing.base, gap: Spacing.base, width: '100%', maxWidth: 960, alignSelf: 'center' } });
