import { createContext, PropsWithChildren, ReactNode, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useOpenMediaTheme } from '../themeContext';
import { AccessibilityInfo, Animated, BackHandler, Dimensions, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { EdgeSwipe } from './edgeSwipe';

/**
 * Native-feeling page stack for phones (ADR 0040), the way UINavigationController moves:
 * a pushed page slides in from the right edge while the page under it slides a third of the way
 * left and dims; Back, or a swipe from the left edge that follows the finger, reverses it. The
 * page underneath stays mounted, so returning keeps its scroll position.
 *
 * Motion is a critically damped spring like SwiftUI's default (`.spring()`, 0.5 s, no bounce), a
 * little quicker for pushes, driven on the UI thread (transform and opacity only). With Reduce
 * Motion on, pages cross-fade instead of sliding.
 */

/** SwiftUI-style spring for a 0.45 s settle with no bounce: stiffness (2π/0.45)², critical damping. */
const pushSpring = { stiffness: 195, damping: 28, mass: 1, overshootClamping: true, restDisplacementThreshold: 0.001, restSpeedThreshold: 0.001 } as const;
/** How far the page underneath moves while covered, as a share of the width (UIKit's parallax). */
const parallax = 0.3;
const native = Platform.OS !== 'web';

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled?.().then((value) => { reduceMotion = value; }).catch(() => undefined);
AccessibilityInfo.addEventListener?.('reduceMotionChanged', (value) => { reduceMotion = value; });

/** Whether the page this component is on is the one in front (not covered by a pushed page). */
const PageActiveContext = createContext(true);
export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}

type AnimatedNumber = Animated.Value | Animated.AnimatedInterpolation<number>;

/**
 * A page's motion: `progress` is where pushing and popping put it (0 off-screen, 1 shown), `drag`
 * is how far a finger has pulled it back right now (points, read on the UI thread), and `shown`
 * combines them. Pages below follow `shown`, so they move with the finger too.
 */
export interface StackMotion { progress: Animated.Value; drag: Animated.Value; shown: AnimatedNumber; width: number }

export function createStackMotion(width = Dimensions.get('window').width): StackMotion {
  const progress = new Animated.Value(0);
  const drag = new Animated.Value(0);
  const pulled = drag.interpolate({ inputRange: [0, width], outputRange: [0, 1], extrapolate: 'clamp' });
  const shown = Animated.subtract(progress, pulled).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  return { progress, drag, shown, width };
}

/** A page's motion that lives as long as the component. */
export function useStackMotion(): StackMotion {
  const motion = useRef<StackMotion | undefined>(undefined);
  if (!motion.current) motion.current = createStackMotion();
  return motion.current;
}

/** How a page moves when the page above it (`covering`) comes in: a third to the left. */
// Uncovered pages still follow an animated zero: with the native driver, a transform whose
// animation is detached keeps its last value, which left a page stuck a third to the left.
const uncovered = new Animated.Value(0);
function coveredStyle(covering: AnimatedNumber | undefined, width: number) {
  if (reduceMotion) return undefined;
  return { transform: [{ translateX: (covering ?? uncovered).interpolate({ inputRange: [0, 1], outputRange: [0, -width * parallax] }) }] };
}

/**
 * The page at the bottom of the stack (a tab). While another page covers it, it moves aside, dims,
 * and is hidden from touch and screen readers.
 */
export function StackBase({ covering, covered, children }: PropsWithChildren<{ covering?: AnimatedNumber; covered: boolean }>) {
  const { width } = useWindowDimensions();
  return <Animated.View
    pointerEvents={covered ? 'none' : 'auto'}
    accessibilityElementsHidden={covered}
    importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
    style={[styles.fill, coveredStyle(covering, width)]}
  >
    <PageActiveContext.Provider value={!covered}>{children}</PageActiveContext.Provider>
    {covering ? <Dim progress={covering} /> : null}
  </Animated.View>;
}

/**
 * A pushed page. It slides in when mounted; when `leaving` turns true it slides out and then calls
 * `onExited`, so its owner removes it. `onBack` is the page's own way back (a swipe from the left
 * edge, or Android's back button when it is on top). `covering` is the page above this one, if any.
 */
export function StackPage({ motion, leaving, onBack, onExited, covering, top, children }: PropsWithChildren<{
  motion: StackMotion;
  leaving: boolean;
  onBack: () => void;
  onExited: () => void;
  covering?: AnimatedNumber;
  /** The page people see and touch now; only it answers Android's back button. */
  top: boolean;
}>) {
  const { colors } = useOpenMediaTheme();
  const width = motion.width;
  const fade = useRef(reduceMotion).current;
  const exited = useRef(onExited);
  exited.current = onExited;
  // A page swiped all the way off is already gone; its exit doesn't animate again.
  const swipedAway = useRef(false);

  useEffect(() => {
    const animation = leaving && swipedAway.current
      ? Animated.timing(motion.progress, { toValue: 0, duration: 0, useNativeDriver: native })
      : fade
        ? Animated.timing(motion.progress, { toValue: leaving ? 0 : 1, duration: 220, useNativeDriver: native })
        : Animated.spring(motion.progress, { toValue: leaving ? 0 : 1, ...pushSpring, useNativeDriver: native });
    animation.start(({ finished }) => { if (finished && leaving) exited.current(); });
    return () => animation.stop();
  }, [leaving, fade, motion]);

  useEffect(() => {
    if (!top || leaving || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => subscription.remove();
  }, [top, leaving, onBack]);

  // Where the finger let go: past half the width (counting a short glide at the release speed) or a
  // quick flick goes back, as UINavigationController does; otherwise the page springs back.
  const swipeEnded = (translationX: number, velocityX: number) => {
    const projected = translationX + velocityX * 0.15;
    if (translationX > 0 && (projected > width * 0.5 || velocityX > 800)) {
      swipedAway.current = true;
      Animated.spring(motion.drag, { toValue: width, ...pushSpring, useNativeDriver: native }).start(({ finished }) => { if (finished) onBack(); });
    } else {
      Animated.spring(motion.drag, { toValue: 0, ...pushSpring, useNativeDriver: native }).start();
    }
  };

  const enter = fade
    ? { opacity: motion.shown }
    : { transform: [{ translateX: motion.shown.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }) }] };
  return <Animated.View
    pointerEvents={leaving || !top ? 'none' : 'auto'}
    accessibilityViewIsModal={top}
    accessibilityElementsHidden={!top}
    importantForAccessibility={top ? 'auto' : 'no-hide-descendants'}
    style={[styles.fill, styles.page, { backgroundColor: colors.surface }, enter]}
  >
    <EdgeSwipe drag={motion.drag} enabled={top && !leaving && !fade} onEnd={swipeEnded}>
      <Animated.View style={[styles.fill, coveredStyle(covering, width)]}>
        <PageActiveContext.Provider value={top}>{children}</PageActiveContext.Provider>
        {covering ? <Dim progress={covering} /> : null}
      </Animated.View>
    </EdgeSwipe>
  </Animated.View>;
}

/** The light shade over a covered page, as iOS draws it. */
function Dim({ progress }: { progress: AnimatedNumber }) {
  return <Animated.View pointerEvents="none" style={[styles.fill, styles.dim, { opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, reduceMotion ? 0 : 0.12] }) }]} />;
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  dim: { backgroundColor: '#000' },
  // The pushed page's left edge casts a soft shadow onto the page it covers.
  page: { shadowColor: '#000', shadowOffset: { width: -4, height: 0 }, shadowOpacity: 0.12, shadowRadius: 10, elevation: 8 },
});

/**
 * Pages in a stack, kept on screen while they slide out (ADR 0040). `items` is what should be shown,
 * bottom to top; an item that drops out stays as `leaving` until its page calls `exited`.
 */
export function useStackEntries<T>(items: T[], keyOf: (item: T) => string) {
  const [entries, setEntries] = useState<{ key: string; item: T; leaving: boolean }[]>([]);
  const motions = useRef(new Map<string, StackMotion>());
  const keys = items.map(keyOf).join('|');
  useEffect(() => {
    setEntries((current) => {
      const wanted = new Map(items.map((item) => [keyOf(item), item]));
      const kept = current.map((entry) => wanted.has(entry.key) ? { key: entry.key, item: wanted.get(entry.key)!, leaving: false } : { ...entry, leaving: true });
      const added = items.filter((item) => !current.some((entry) => entry.key === keyOf(item))).map((item) => ({ key: keyOf(item), item, leaving: false }));
      return [...kept, ...added];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  // The newest item's data (a profile that changed while open) replaces what the entry holds.
  const live = entries.map((entry) => {
    const item = items.find((candidate) => keyOf(candidate) === entry.key);
    return item && !entry.leaving ? { ...entry, item } : entry;
  });
  const motionOf = (key: string) => {
    let value = motions.current.get(key);
    if (!value) { value = createStackMotion(); motions.current.set(key, value); }
    return value;
  };
  const exited = (key: string) => {
    motions.current.delete(key);
    setEntries((current) => current.filter((entry) => entry.key !== key || !entry.leaving));
  };
  return { entries: live, motionOf, exited };
}

/**
 * A page drawn above the app's own header and tabs from deep inside a screen (the Messages thread),
 * without re-rendering the whole app: the screen writes into this slot, and only `LayerSlotView`
 * redraws.
 */
export interface SlotLayer { key: string; node: ReactNode; onBack: () => void }
export function createLayerSlot() {
  let layer: SlotLayer | undefined;
  const listeners = new Set<() => void>();
  return {
    set(next: SlotLayer | undefined) { layer = next; listeners.forEach((listener) => listener()); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    get: () => layer,
  };
}
export type LayerSlot = ReturnType<typeof createLayerSlot>;
export const LayerSlotContext = createContext<LayerSlot | null>(null);

/** Writes a page into the slot on every render, and clears it when the screen lets go. */
export function useSlotLayer(layer: SlotLayer | undefined) {
  const slot = useContext(LayerSlotContext);
  useEffect(() => { slot?.set(layer); });
  useEffect(() => () => slot?.set(undefined), [slot]);
  return Boolean(slot);
}

export type SlotState = 'open' | 'leaving' | 'closed';
/**
 * Draws the slot's page as a stack page, sliding it out when the screen lets go. `onStateChange`
 * reports 'leaving' while it slides out and 'closed' only once it is gone, so the page underneath
 * keeps following it all the way back.
 */
export function LayerSlotView({ slot, motion, covering, top, onStateChange }: { slot: LayerSlot; motion: StackMotion; covering?: AnimatedNumber; top: boolean; onStateChange: (state: SlotState) => void }) {
  const layer = useSyncExternalStore(slot.subscribe, slot.get, slot.get);
  const [shown, setShown] = useState<SlotLayer>();
  const changed = useRef(onStateChange);
  changed.current = onStateChange;
  const open = Boolean(layer);
  useEffect(() => { if (layer) setShown(layer); }, [layer]);
  useEffect(() => {
    if (open) changed.current('open');
    else if (shown) changed.current('leaving');
    else changed.current('closed');
  }, [open, Boolean(shown)]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return <StackPage motion={motion} leaving={!layer} top={top && Boolean(layer)} covering={covering} onBack={shown.onBack} onExited={() => setShown(undefined)}>
    {layer?.node ?? shown.node}
  </StackPage>;
}
