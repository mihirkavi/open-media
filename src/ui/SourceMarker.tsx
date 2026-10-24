import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

import { MessageSource } from '../domain/models';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';

const sourceDetails: Record<MessageSource, { icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  open_media: { icon: 'chatbubble-ellipses-outline', label: 'Open Media' },
  matrix: { icon: 'git-network-outline', label: 'Matrix' },
  gmail: { icon: 'mail-outline', label: 'Gmail' },
  icloud: { icon: 'mail-outline', label: 'iCloud Mail' },
  imap: { icon: 'mail-outline', label: 'Email' },
  instagram: { icon: 'camera-outline', label: 'Instagram' },
  linkedin: { icon: 'briefcase-outline', label: 'LinkedIn' },
  snapchat: { icon: 'flash-outline', label: 'Snapchat' },
  sms: { icon: 'chatbubble-outline', label: 'SMS' },
  whatsapp: { icon: 'logo-whatsapp', label: 'WhatsApp' },
  telegram: { icon: 'paper-plane-outline', label: 'Telegram' },
  signal: { icon: 'chatbubbles-outline', label: 'Signal' },
  gmessages: { icon: 'chatbox-outline', label: 'Google Messages' },
  gvoice: { icon: 'call-outline', label: 'Google Voice' },
  messenger: { icon: 'chatbubble-outline', label: 'Messenger' },
  twitter: { icon: 'at-outline', label: 'X' },
  bluesky: { icon: 'cloud-outline', label: 'Bluesky' },
  slack: { icon: 'logo-slack', label: 'Slack' },
  discord: { icon: 'logo-discord', label: 'Discord' },
};

export function sourceLabel(source: MessageSource): string {
  return sourceDetails[source].label;
}

/** A quiet, monochrome hint of where a message came from. */
export function SourceMarker({ source, showLabel = false, inverse = false }: { source: MessageSource; showLabel?: boolean; inverse?: boolean }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const detail = sourceDetails[source];
  const foreground = inverse ? colors.surface : colors.textTertiary;

  return (
    <View accessibilityLabel={`Source: ${detail.label}`} style={styles.marker}>
      <Ionicons name={detail.icon} size={11} color={foreground} />
      {showLabel ? <Text style={[styles.label, { color: foreground }]}>{detail.label}</Text> : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    marker: { minHeight: 16, flexDirection: 'row', alignItems: 'center', gap: 4 },
    label: { fontSize: 11, fontWeight: '600', color: colors.textTertiary },
  });
}
