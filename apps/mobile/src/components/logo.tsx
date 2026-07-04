import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { colors } from '@/lib/theme';

export function LogoMark({ size = 24 }: { readonly size?: number }) {
  return (
    <Svg viewBox='0 0 24 24' width={size} height={size} accessibilityLabel='Tether'>
      <Path d='M9.4 14.6 14.6 9.4' stroke={colors.brand} strokeWidth={2.4} strokeLinecap='round' />
      <Circle cx={7} cy={17} r={3.4} fill={colors.foreground} />
      <Circle
        cx={7}
        cy={17}
        r={6}
        fill='none'
        stroke={colors.foreground}
        strokeWidth={1.2}
        opacity={0.35}
      />
      <Circle cx={17} cy={7} r={3.4} fill={colors.foreground} />
    </Svg>
  );
}

export function Wordmark({ size = 24 }: { readonly size?: number }) {
  return (
    <View style={styles.wordmark}>
      <LogoMark size={size} />
      <Text style={[styles.wordmarkText, { fontSize: size * 0.85 }]}>tether</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wordmarkText: { color: colors.foreground, fontWeight: '500', letterSpacing: -0.5 },
});
