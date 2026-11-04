import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";

import Ionicons from "./Icon";
import { Text } from "./Text";
import { MessageReaction } from "../domain/models";
import { describeReaction, myReaction, summarizeReactions, tapbacks } from "../domain/reactions";
import { ThemeColors } from "../theme";
import { useOpenMediaTheme } from "../themeContext";

/**
 * The tapback bar, like iMessage: six quick reactions in a floating pill above the bubble, the
 * one you already chose ringed, and Reply at the end. It pops in with a small spring.
 */
export function TapbackBar({
  outbound,
  reactions,
  reduceMotion,
  onReact,
  onReply,
}: {
  outbound: boolean;
  reactions?: MessageReaction[];
  reduceMotion: boolean;
  onReact?: (emoji: string) => void;
  onReply?: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const mine = myReaction(reactions);
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (reduceMotion) return;
    Animated.spring(progress, { toValue: 1, friction: 7, tension: 140, useNativeDriver: Platform.OS !== "web" }).start();
  }, [progress, reduceMotion]);
  return (
    <Animated.View
      accessibilityRole="menu"
      accessibilityLabel="React or reply"
      style={[
        styles.bar,
        outbound ? styles.barOutbound : styles.barInbound,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) },
          ],
        },
      ]}
    >
      {onReact
        ? tapbacks.map((emoji) => (
            <Pressable
              key={emoji}
              accessibilityRole="menuitem"
              accessibilityLabel={emoji === mine ? `Remove ${emoji}` : `React with ${emoji}`}
              accessibilityState={{ selected: emoji === mine }}
              onPress={() => onReact(emoji)}
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                styles.choice,
                emoji === mine && styles.choiceMine,
                hovered && styles.choiceHover,
                pressed && styles.choicePressed,
              ]}
            >
              <Text style={styles.choiceEmoji}>{emoji}</Text>
            </Pressable>
          ))
        : null}
      {onReply ? (
        <>
          {onReact ? <View style={styles.divider} /> : null}
          <Pressable
            accessibilityRole="menuitem"
            accessibilityLabel="Reply"
            onPress={onReply}
            style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.choice, hovered && styles.choiceHover, pressed && styles.choicePressed]}
          >
            <Ionicons name="arrow-undo-outline" size={19} color={colors.text} />
          </Pressable>
        </>
      ) : null}
    </Animated.View>
  );
}

/**
 * Reactions on a message, tucked over its top corner like iMessage tapbacks: on the outer corner
 * of messages you receive, the inner one of yours. Yours is drawn dark, other people's light, and
 * a small trailing dot ties the badge to the bubble.
 */
export function ReactionBadges({
  outbound,
  reactions,
  nameOf,
  onPress,
}: {
  outbound: boolean;
  reactions?: MessageReaction[];
  nameOf: (personId: string) => string;
  onPress?: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const summary = summarizeReactions(reactions);
  const pop = useRef(new Animated.Value(1)).current;
  const signature = summary.map((item) => `${item.emoji}${item.count}${item.mine ? "m" : ""}`).join();
  const first = useRef(true);
  // A reaction arriving (or changing) gives the badge a small bounce.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 180, useNativeDriver: Platform.OS !== "web" }).start();
  }, [signature, pop]);
  if (!summary.length) return null;
  const total = summary.reduce((sum, item) => sum + item.count, 0);
  const mine = summary.some((item) => item.mine);
  // On one-to-one chats, one badge per emoji reads best; past three, they collapse into a count.
  const shown = summary.slice(0, 3);
  const label = summary.map((item) => describeReaction(item, nameOf)).join(". ");
  return (
    <Animated.View pointerEvents="box-none" style={[styles.badges, outbound ? styles.badgesOutbound : styles.badgesInbound, { transform: [{ scale: pop }] }]}>
      <Pressable
        accessibilityRole={onPress ? "button" : undefined}
        accessibilityLabel={label}
        accessibilityHint={onPress ? "Change your reaction" : undefined}
        disabled={!onPress}
        onPress={onPress}
        style={[styles.badge, mine && summary.length === 1 && styles.badgeMine]}
      >
        {shown.map((item) => (
          <Text key={item.emoji} style={styles.badgeEmoji}>{item.emoji}</Text>
        ))}
        {total > shown.length ? <Text style={[styles.badgeCount, mine && summary.length === 1 && styles.badgeCountMine]}>{total}</Text> : null}
      </Pressable>
      <View style={[styles.badgeDot, outbound ? styles.badgeDotOutbound : styles.badgeDotInbound, mine && summary.length === 1 && styles.badgeMine]} />
    </Animated.View>
  );
}

function createStyles(colors: ThemeColors) {
  const shadow = Platform.select({
    web: { boxShadow: "0 6px 24px rgba(0,0,0,0.14), 0 1px 3px rgba(0,0,0,0.08)" },
    default: { shadowColor: "#000", shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 8 },
  }) as object;
  return StyleSheet.create({
    bar: {
      position: "absolute",
      bottom: "100%",
      marginBottom: 8,
      zIndex: 30,
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
      paddingHorizontal: 5,
      paddingVertical: 5,
      borderRadius: 26,
      backgroundColor: colors.surface,
      userSelect: "none",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...shadow,
    },
    barInbound: { left: 0 },
    barOutbound: { right: 0 },
    choice: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      // @ts-expect-error web-only style
      transitionProperty: "transform, background-color",
      transitionDuration: "140ms",
    },
    choiceHover: { backgroundColor: colors.chrome, transform: [{ scale: 1.18 }] },
    choicePressed: { transform: [{ scale: 0.9 }] },
    choiceMine: { backgroundColor: colors.bubble },
    choiceEmoji: { fontSize: 22, lineHeight: 28 },
    divider: { width: StyleSheet.hairlineWidth, height: 24, marginHorizontal: 3, backgroundColor: colors.border },
    badges: { position: "absolute", top: -20, zIndex: 2 },
    badgesInbound: { right: -14 },
    badgesOutbound: { left: -14 },
    badge: {
      minWidth: 32,
      height: 32,
      paddingHorizontal: 7,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 1,
      borderRadius: 16,
      backgroundColor: colors.bubble,
      borderWidth: 2.5,
      borderColor: colors.surface,
    },
    badgeMine: { backgroundColor: colors.text },
    badgeEmoji: { fontSize: 15, lineHeight: 19 },
    badgeCount: { marginLeft: 2, color: colors.textSecondary, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] },
    badgeCountMine: { color: colors.surface },
    // The tapback's little tail: a dot just below the badge.
    badgeDot: {
      position: "absolute",
      bottom: -2,
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: colors.bubble,
      borderWidth: 1.5,
      borderColor: colors.surface,
    },
    // The tail sits on the bubble's edge, tying the badge to the message it reacts to.
    badgeDotInbound: { left: 2 },
    badgeDotOutbound: { right: 2 },
  });
}
