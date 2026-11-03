import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { useReducedMotion } from './AiMark';

const width = 168;
const height = 44;
const small = 5;
const answer = 18;
const rows = [0.18, 0.5, 0.82];
const perRow = 4;
const answerX = width - answer;

/**
 * The AI summary's own loading drawing, told in the AI mark's language: three rows of small dots,
 * the posts being read, stream to the right and gather into one larger dot, the answer, which
 * swells as each one arrives. It is the mark itself at a larger scale, so the wait reads as AI and
 * never as the Open Media loader used for everything else. With reduced motion on, the dots stay
 * in place and the answer dot only breathes.
 */
export function AiThinking({ color }: { color: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    progress.setValue(0);
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: reduced ? 2400 : 2200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduced, progress]);

  // The cycle shifted by `offset`, so dots in a row follow one another along the same path.
  const shifted = (offset: number) => offset < 0.001 ? progress : progress.interpolate({ inputRange: [0, 1 - offset, 1 - offset + 0.0001, 1], outputRange: [offset, 1, 0, offset] });
  const swell = reduced
    ? progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.85, 1, 0.85] })
    : progress.interpolate({ inputRange: [0, 0.12, 0.2, 0.37, 0.45, 0.62, 0.7, 0.87, 0.95, 1], outputRange: [0.86, 0.86, 1, 0.88, 1, 0.88, 1, 0.88, 1, 0.86] });

  const centerY = height / 2;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={styles.box}>
    {rows.flatMap((row, rowIndex) => Array.from({ length: perRow }, (_, dotIndex) => {
      const startY = row * height - small / 2;
      const key = `${rowIndex}-${dotIndex}`;
      if (reduced) {
        return <View key={key} style={[styles.dot, { left: dotIndex * 16, top: startY, opacity: 0.25 + dotIndex * 0.15, backgroundColor: color }]} />;
      }
      const t = shifted((dotIndex / perRow + rowIndex * 0.08) % 1);
      // Straight at first, then bending toward the answer dot's centre, easing into it.
      const x = t.interpolate({ inputRange: [0, 1], outputRange: [0, answerX + answer / 2 - small / 2], easing: Easing.in(Easing.quad) });
      const y = t.interpolate({ inputRange: [0, 0.45, 1], outputRange: [0, 0, centerY - small / 2 - startY], easing: Easing.inOut(Easing.cubic) });
      const opacity = t.interpolate({ inputRange: [0, 0.12, 0.8, 0.98, 1], outputRange: [0, 0.9, 0.9, 0, 0] });
      const scale = t.interpolate({ inputRange: [0, 0.75, 1], outputRange: [1, 1, 0.4] });
      return <Animated.View key={key} style={[styles.dot, { left: 0, top: startY, backgroundColor: color, opacity, transform: [{ translateX: x }, { translateY: y }, { scale }] }]} />;
    }))}
    <Animated.View style={[styles.answer, { left: answerX, top: centerY - answer / 2, backgroundColor: color, transform: [{ scale: swell }] }]} />
  </View>;
}

const styles = StyleSheet.create({
  box: { width, height, marginVertical: 2 },
  dot: { position: 'absolute', width: small, height: small, borderRadius: small / 2 },
  answer: { position: 'absolute', width: answer, height: answer, borderRadius: answer / 2 },
});
