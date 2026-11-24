import { View, Text, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SWISHFLIP } from '@/constants/brand';
import { Typography } from '@/constants/theme';

type Props = { compact?: boolean; descriptor?: boolean; dark?: boolean };

/** Crisp native rendering of the master platform mark; no bitmap dependency. */
export function SwishFlipBrand({ compact = false, descriptor = false, dark = false }: Props) {
  const swish = dark ? SWISHFLIP.colors.midnight : SWISHFLIP.colors.arctic;
  return <View accessibilityRole="image" accessibilityLabel="SWISHFlip" style={s.row}>
    <Svg width={compact ? 32 : 40} height={compact ? 32 : 40} viewBox="0 0 64 64" fill="none">
      <Path d="M15 25V17a2 2 0 0 1 2-2h8M39 15h8a2 2 0 0 1 2 2v8M49 39v8a2 2 0 0 1-2 2h-8M25 49h-8a2 2 0 0 1-2-2v-8" stroke={SWISHFLIP.colors.gold} strokeWidth={3} strokeLinecap="round" />
      <Path d="M45.5 20.5c-3.2-3-7.9-4.8-13.1-4.8-8.5 0-15.4 4.3-15.4 9.6 0 5.2 6.5 7.2 14.6 8.5 6.4 1 10.4 2 10.4 5.2 0 3.6-4.9 6.2-11 6.2-6.8 0-11.6-2.7-14.2-6.2" stroke={SWISHFLIP.colors.gold} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M20 42.5c3.1 3.7 7.2 5.8 12.2 5.8 8.7 0 15.8-4.8 15.8-10.8 0-5.3-5.8-7.6-14.3-8.9-6.8-1-10.7-1.9-10.7-5 0-3.4 4.4-5.8 10.1-5.8 5.5 0 9.8 2.1 12.4 5.3" stroke={SWISHFLIP.colors.teal} strokeWidth={2.1} strokeLinecap="round" opacity={0.9} />
    </Svg>
    {!compact && <View style={s.copy}><Text style={[s.wordmark, { color: swish }]}><Text>SWISH</Text><Text style={s.flip}>FLIP</Text></Text>{descriptor ? <Text style={[s.descriptor, { color: dark ? SWISHFLIP.colors.deepOcean : SWISHFLIP.colors.steel }]}>{SWISHFLIP.descriptor.toUpperCase()}</Text> : null}</View>}
  </View>;
}

const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  copy: { gap: 2, flexShrink: 1 },
  wordmark: { fontSize: Typography.size.lg, lineHeight: 22, fontWeight: Typography.weight.extrabold, fontStyle: 'italic', letterSpacing: -1.1, includeFontPadding: false },
  flip: { color: SWISHFLIP.colors.gold },
  descriptor: { fontSize: 8, lineHeight: 11, fontWeight: Typography.weight.bold, letterSpacing: 1.1, includeFontPadding: false },
});
