import { PropsWithChildren } from 'react';
import { Animated } from 'react-native';

/**
 * Web: browsers have their own back swipe, so pages take no edge gesture and the gesture library
 * stays out of the web bundle. The phone version is `edgeSwipe.native.tsx` (ADR 0040).
 */
export function EdgeSwipe({ children }: PropsWithChildren<{ drag: Animated.Value; enabled: boolean; onEnd: (translationX: number, velocityX: number) => void }>) {
  return <>{children}</>;
}

export function GestureRoot({ children }: PropsWithChildren) {
  return <>{children}</>;
}
