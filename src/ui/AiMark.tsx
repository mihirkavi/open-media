import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';

/**
 * Open Media's mark for anything written by AI: three small dots, the posts it read, flowing into
 * one, the answer. Drawn with plain views so it is the same on web, iOS and Android, and always in
 * the text colour around it. Always shown next to the words “AI …”, never on its own.
 *
 * While the AI is working (`thinking`), the three dots light up one after another and drift toward
 * the answer dot, which swells as each reaches it, so the mark itself shows the reading. With reduced motion on, the
 * mark only breathes softly.
 */
export function AiMark({ size = 16, color, thinking = false }: { size?: number; color: string; thinking?: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!thinking) { progress.stopAnimation(); progress.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: reduced ? 2400 : 1500, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [thinking, reduced, progress]);

  // Each small dot peaks in its own third of the cycle; the answer dot swells just after each one.
  const wave = (start: number) => progress.interpolate({ inputRange: [0, start, start + 0.16, start + 0.36, 1], outputRange: [0.28, 0.28, 1, 0.28, 0.28], extrapolate: 'clamp' });
  const breathe = progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.55, 1, 0.55] });
  const swell = progress.interpolate({ inputRange: [0, 0.2, 0.3, 0.5, 0.6, 0.8, 0.9, 1], outputRange: [0.86, 0.86, 1, 0.9, 1, 0.9, 1, 0.86] });

  const dot = (left: number, top: number, diameter: number, style?: object) => <Animated.View style={[{ position: 'absolute', left: left * size, top: top * size, width: diameter * size, height: diameter * size, borderRadius: (diameter * size) / 2, backgroundColor: color }, style]} />;
  // A lit dot also drifts toward the answer dot, so the reading visibly flows into it.
  const drift = (start: number) => progress.interpolate({ inputRange: [0, start, start + 0.16, start + 0.36, 1], outputRange: [0, 0, size * 0.14, 0, 0], extrapolate: 'clamp' });
  const small = (index: number) => (!thinking ? undefined : reduced ? { opacity: breathe } : { opacity: wave(index * 0.22), transform: [{ translateX: drift(index * 0.22) }] });
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    {dot(0.04, 0.08, 0.2, small(0))}
    {dot(0.04, 0.4, 0.2, small(1))}
    {dot(0.04, 0.72, 0.2, small(2))}
    {dot(0.46, 0.27, 0.46, !thinking ? undefined : reduced ? { opacity: breathe } : { transform: [{ scale: swell }] })}
  </View>;
}

/** True when the person asked their device for less motion. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => { if (active) setReduced(enabled); }).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { active = false; subscription.remove(); };
  }, []);
  return reduced;
}
