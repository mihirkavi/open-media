/**
 * A GIF, sticker or avatar sticker drawn in a conversation (ADR 0029). Stickers stand on their own
 * without a bubble; a GIF sits in a rounded frame. If it can't load, the link shows instead, so
 * nothing is ever lost.
 */
import { useMemo, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, View } from "react-native";
import { MessageMedia } from "../domain/messageMedia";
import { ThemeColors } from "../theme";
import { useOpenMediaTheme } from "../themeContext";
import { Text } from "./Text";

const gifWidth = 240;
const stickerSize = 132;

export function MessageMediaView({ media, outbound, pending }: { media: MessageMedia; outbound: boolean; pending?: boolean }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (failed) {
    return (
      <Pressable accessibilityRole="link" onPress={() => Linking.openURL(media.url).catch(() => undefined)} style={[styles.fallback, outbound && styles.fallbackOutbound]}>
        <Text numberOfLines={1} style={[styles.fallbackText, outbound && styles.fallbackTextOutbound]}>{media.label} · open link</Text>
      </Pressable>
    );
  }
  const gif = media.kind === "gif";
  const width = gif ? Math.min(gifWidth, gifWidth * Math.max(media.aspectRatio, 0.75)) : stickerSize;
  const height = gif ? width / media.aspectRatio : stickerSize;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={media.label}
      style={[gif ? styles.gifFrame : styles.sticker, { width, height }, !loaded && gif && styles.loading, pending && styles.pending]}
    >
      <Image
        source={{ uri: media.displayUrl }}
        resizeMode={gif ? "cover" : "contain"}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        style={styles.image}
      />
      {gif ? <Text style={styles.badge}>GIF</Text> : null}
    </View>
  );
}

/** One to three emoji alone are drawn large, the way people expect from chat apps. */
export function JumboEmoji({ text, count }: { text: string; count: number }) {
  const size = count === 1 ? 52 : count === 2 ? 44 : 38;
  return <Text accessibilityLabel={text} style={{ fontSize: size, lineHeight: size * 1.22, paddingVertical: 2 }}>{text.trim()}</Text>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    gifFrame: { borderRadius: 18, overflow: "hidden", backgroundColor: colors.chrome },
    loading: { backgroundColor: colors.bubble },
    sticker: { },
    pending: { opacity: 0.72 },
    image: { width: "100%", height: "100%" },
    badge: {
      position: "absolute",
      left: 8,
      bottom: 8,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 6,
      overflow: "hidden",
      backgroundColor: "rgba(0,0,0,0.45)",
      color: "#FFFFFF",
      fontSize: 9,
      fontWeight: "800",
      letterSpacing: 0.8,
    },
    fallback: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.bubble },
    fallbackOutbound: { backgroundColor: colors.text },
    fallbackText: { color: colors.text, fontSize: 14 },
    fallbackTextOutbound: { color: colors.surface },
  });
}
