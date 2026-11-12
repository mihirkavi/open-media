import { PropsWithChildren } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { GestureHandlerRootView, PanGestureHandler, PanGestureHandlerStateChangeEvent, State } from 'react-native-gesture-handler';

/**
 * Swipe back from the left edge on phones (ADR 0040). The drag is read on the UI thread and fed to
 * `drag` without going through JavaScript, so the page follows the finger exactly; JavaScript
 * only hears where the finger let go. Starts within 28 points of the left edge, rightward only.
 */
export function EdgeSwipe({ drag, enabled, onEnd, children }: PropsWithChildren<{ drag: Animated.Value; enabled: boolean; onEnd: (translationX: number, velocityX: number) => void }>) {
  const onGestureEvent = Animated.event([{ nativeEvent: { translationX: drag } }], { useNativeDriver: true });
  const onHandlerStateChange = (event: PanGestureHandlerStateChangeEvent) => {
    const { state, translationX, velocityX } = event.nativeEvent;
    if (state === State.END || state === State.CANCELLED || state === State.FAILED) onEnd(state === State.END ? translationX : 0, state === State.END ? velocityX : 0);
  };
  return <PanGestureHandler enabled={enabled} hitSlop={{ left: 0, width: 28 }} activeOffsetX={10} failOffsetY={[-14, 14]} onGestureEvent={onGestureEvent} onHandlerStateChange={onHandlerStateChange}>
    <Animated.View style={styles.fill}>{children}</Animated.View>
  </PanGestureHandler>;
}

/** The gesture library's root, which phones need once around the app. */
export function GestureRoot({ children }: PropsWithChildren) {
  return <GestureHandlerRootView style={styles.fill}>{children}</GestureHandlerRootView>;
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
