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

/**
 * Ask or search: a magnifying glass holding the AI mark's three dots, one mark for searching Open
 * Media and asking Open Media AI, because the same field does both. Its proportions and stroke
 * follow the Ionicons outline set, so it sits evenly beside the other navigation icons. While it
 * works (`thinking`), the dots light up one after another, like someone typing.
 */
export function AskMark({ size = 21, color, thinking = false }: { size?: number; color: string; thinking?: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!thinking) { progress.stopAnimation(); progress.setValue(0); return; }
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: reduced ? 2400 : 1500, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [thinking, reduced, progress]);
  const wave = (start: number) => progress.interpolate({ inputRange: [0, start, start + 0.16, start + 0.36, 1], outputRange: [0.3, 0.3, 1, 0.3, 0.3], extrapolate: 'clamp' });
  // Lens centred at (0.42, 0.42) of the box, as in Ionicons' search glyph; the handle leaves its rim at 45°.
  const centre = 0.42 * size;
  const ring = 0.72 * size;
  const stroke = Math.max(1.5, 0.08 * size);
  const handle = 0.27 * size;
  const reach = ring / 2 - stroke / 2 + handle / 2;
  const handleCentre = centre + reach * Math.SQRT1_2;
  // Three dots across the middle of the lens.
  const dot = Math.max(1.6, 0.1 * size);
  const gap = 0.07 * size;
  const firstDot = centre - (3 * dot + 2 * gap) / 2;
  const dotView = (index: number) => <Animated.View key={index} style={{ position: 'absolute', left: firstDot + index * (dot + gap), top: centre - dot / 2, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: color, opacity: thinking ? wave(index * 0.22) : 1 }} />;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    <View style={{ position: 'absolute', left: centre - ring / 2, top: centre - ring / 2, width: ring, height: ring, borderRadius: ring / 2, borderWidth: stroke, borderColor: color }} />
    <View style={{ position: 'absolute', left: handleCentre - handle / 2, top: handleCentre - stroke / 2, width: handle, height: stroke, borderRadius: stroke / 2, backgroundColor: color, transform: [{ rotate: '45deg' }] }} />
    {[0, 1, 2].map(dotView)}
  </View>;
}
