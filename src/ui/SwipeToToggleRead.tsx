import Ionicons from "./Icon";
import { useThemedStyles } from './useThemedStyles';
import { PropsWithChildren, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, PanResponder, Platform, StyleSheet, View } from "react-native";

import { useOpenMediaTheme } from "../themeContext";
import { Text } from "./Text";

/** How far a row must travel before letting go marks it; past this it also clicks into place. */
const trigger = 72;
/** The most a row moves, with resistance beyond the trigger. */
const limit = 120;

const travel = (dx: number) => (dx <= trigger ? Math.max(0, dx) : Math.min(limit, trigger + (dx - trigger) * 0.35));

/**
 * A Messages row that, swiped to the right, marks its conversation read or unread, as in Apple
 * Mail and Messages. Fingers on a phone or the web drag it; on a Mac trackpad a two-finger swipe
 * does the same. Screen readers get the same thing as an action on the row ("Mark as unread").
 * With no `onToggle` (Open Media AI, the Matrix demo) the row is a plain row.
 */
export function SwipeToToggleRead({ unread, onToggle, children }: PropsWithChildren<{ unread: boolean; onToggle?: () => void }>) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const x = useRef(new Animated.Value(0)).current;
  const [armed, setArmed] = useState(false);
  const latest = useRef({ onToggle, armed });
  latest.current = { onToggle, armed };
  const frame = useRef<View>(null);

  const settle = (dx: number) => {
    if (dx >= trigger) latest.current.onToggle?.();
    setArmed(false);
    Animated.timing(x, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
  };
  const follow = (dx: number) => {
    x.setValue(travel(dx));
    const next = dx >= trigger;
    if (next !== latest.current.armed) setArmed(next);
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Only a clearly sideways drag to the right: scrolling the list and taps stay as they were.
        onMoveShouldSetPanResponder: (_, gesture) => Boolean(latest.current.onToggle) && gesture.dx > 10 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, gesture) => follow(gesture.dx),
        onPanResponderRelease: (_, gesture) => settle(gesture.dx),
        onPanResponderTerminate: () => settle(0),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // A two-finger swipe on a trackpad arrives as sideways wheel events; one gesture is a run of
  // them under 160 ms apart. Taking them also stops the browser going back a page.
  useEffect(() => {
    if (Platform.OS !== "web" || !onToggle) return;
    const node = frame.current as unknown as HTMLElement | null;
    if (!node?.addEventListener) return;
    let dx = 0;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      // Fingers moving right scroll content right, which the browser reports as negative deltaX.
      dx = Math.max(0, dx - event.deltaX);
      follow(dx);
      clearTimeout(idle);
      idle = setTimeout(() => { settle(dx); dx = 0; }, 160);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => { node.removeEventListener("wheel", onWheel); clearTimeout(idle); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(onToggle)]);

  if (!onToggle) return <>{children}</>;
  const label = unread ? "Read" : "Unread";
  return (
    <View
      ref={frame}
      style={[styles.frame, Platform.OS === "web" ? ({ touchAction: "pan-y", userSelect: "none" } as object) : null]}
      accessibilityActions={[{ name: "toggleRead", label: unread ? "Mark as read" : "Mark as unread" }]}
      onAccessibilityAction={(event) => { if (event.nativeEvent.actionName === "toggleRead") onToggle(); }}
      {...responder.panHandlers}
    >
      <Animated.View
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
        style={[styles.action, { opacity: x.interpolate({ inputRange: [0, 24, trigger], outputRange: [0, 0.6, 1], extrapolate: "clamp" }) }]}
      >
        {/* Filled once letting go will mark it. */}
        <Ionicons name={unread ? (armed ? "mail-open" : "mail-open-outline") : armed ? "mail-unread" : "mail-unread-outline"} size={22} color={colors.surface} />
        <Text style={styles.actionText}>{label}</Text>
      </Animated.View>
      <Animated.View style={[styles.front, { transform: [{ translateX: x }] }]}>{children}</Animated.View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useOpenMediaTheme>["colors"]) {
  return StyleSheet.create({
    frame: { position: "relative", marginHorizontal: 8, borderRadius: 14, overflow: "hidden" },
    action: {
      position: "absolute", top: 0, right: 0, bottom: 0, left: 0,
      backgroundColor: colors.accent,
      borderRadius: 14,
      flexDirection: "column",
      alignItems: "flex-start",
      justifyContent: "center",
      paddingLeft: 22,
      gap: 2,
    },
    actionText: { color: colors.surface, fontSize: 12, fontWeight: "600" },
    front: { backgroundColor: colors.surface, borderRadius: 14 },
  });
}
