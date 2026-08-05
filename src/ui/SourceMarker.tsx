import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import { MessageSource } from '../domain/models';
import { colors } from '../theme';

const sourceDetails: Record<MessageSource, { icon: keyof typeof Ionicons.glyphMap; label: string; color: string }> = {
  gmail: { icon: 'mail-outline', label: 'Gmail', color: '#D84B40' },
  icloud: { icon: 'mail-outline', label: 'iCloud Mail', color: '#1687FF' },
  imap: { icon: 'mail-outline', label: 'Email', color: '#6D7179' },
  instagram: { icon: 'camera-outline', label: 'Instagram', color: '#B04CC2' },
  linkedin: { icon: 'briefcase-outline', label: 'LinkedIn', color: '#2677B9' },
  snapchat: { icon: 'flash-outline', label: 'Snapchat', color: '#D6A900' },
  sms: { icon: 'chatbubble-outline', label: 'SMS', color: '#2E9E55' },
};

export function sourceLabel(source: MessageSource): string {
  return sourceDetails[source].label;
}

export function SourceMarker({ source, showLabel = false, inverse = false }: { source: MessageSource; showLabel?: boolean; inverse?: boolean }) {
  const detail = sourceDetails[source];
  const foreground = inverse ? 'rgba(255,255,255,0.82)' : detail.color;

  return (
    <View accessibilityLabel={`Source: ${detail.label}`} style={[styles.marker, inverse && styles.markerInverse]}>
      <Ionicons name={detail.icon} size={9} color={foreground} />
      {showLabel ? <Text style={[styles.label, { color: foreground }]}>{detail.label}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  marker: { height: 16, minWidth: 16, paddingHorizontal: 3, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  markerInverse: { backgroundColor: 'rgba(0,0,0,0.1)', borderColor: 'rgba(255,255,255,0.16)' },
  label: { fontSize: 8, fontWeight: '600' },
});
