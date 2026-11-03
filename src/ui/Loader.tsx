import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, View, ViewStyle } from 'react-native';

import { useOpenMediaTheme } from '../themeContext';
import { useReducedMotion } from './AiMark';

const sizes = { small: 18, large: 34 } as const;

/**
 * Open Media's loading mark: the logo, two speech bubbles circling each other, turning half a turn
 * at a time. The mark looks the same after half a turn, so each step eases in and settles like a
 * breath instead of spinning. It takes the same `size` and `color` as the system spinner it
 * replaces, and the logo is tinted to that colour so it also works on inverted buttons. With
 * reduced motion on, it stays still and only fades softly.
 */
export function Loader({ size = 'small', color, style, accessibilityLabel = 'Loading' }: { size?: 'small' | 'large' | number; color?: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  const { colors, isDark } = useOpenMediaTheme();
  const reduced = useReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced) {
      const loop = Animated.loop(Animated.sequence([
        Animated.timing(fade, { toValue: 0.4, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(fade, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]));
      loop.start();
      return () => loop.stop();
    }
    fade.setValue(1);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(turn, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.cubic), useNativeDriver: true }),
      Animated.delay(120),
    ]));
    turn.setValue(0);
    loop.start();
    return () => loop.stop();
  }, [reduced, turn, fade]);

  const side = typeof size === 'number' ? size : sizes[size];
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  return <View accessibilityRole="progressbar" accessibilityLabel={accessibilityLabel} style={[{ width: side, height: side, alignItems: 'center', justifyContent: 'center' }, style]}>
    <Animated.Image
      source={isDark ? require('../../assets/brand/logo-dark.png') : require('../../assets/brand/logo-light.png')}
      resizeMode="contain"
      style={{ width: side, height: side, tintColor: color ?? colors.text, opacity: fade, transform: [{ rotate }] }}
    />
  </View>;
}
