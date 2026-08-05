import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Account } from '../domain/models';
import { colors, radii } from '../theme';

interface SourceRailProps {
  accounts: Account[];
  selectedAccountId: string | 'all';
  onSelectAccount: (id: string | 'all') => void;
}

export function SourceRail({ accounts, selectedAccountId, onSelectAccount }: SourceRailProps) {
  return (
    <View style={styles.rail}>
      <View style={styles.brandMark}>
        <View style={styles.brandBubble} />
        <View style={styles.brandBubbleSmall} />
      </View>

      <View style={styles.navigation}>
        <RailButton
          icon="chatbubbles"
          label="All inboxes"
          count={accounts.reduce((total, account) => total + account.unreadCount, 0)}
          active={selectedAccountId === 'all'}
          onPress={() => onSelectAccount('all')}
        />
        <Text style={styles.sectionLabel}>SOURCES</Text>
        {accounts.map((account) => (
          <RailButton
            key={account.id}
            icon={account.source === 'gmail' ? 'mail' : 'cloud'}
            label={account.label}
            count={account.unreadCount}
            color={account.color}
            active={selectedAccountId === account.id}
            onPress={() => onSelectAccount(account.id)}
          />
        ))}
      </View>

      <View style={styles.footer}>
        <RailButton icon="settings-outline" label="Settings" active={false} onPress={() => {}} />
        <View style={styles.profile}>
          <View style={styles.profileAvatar}><Text style={styles.profileInitials}>MK</Text></View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName}>Mihir</Text>
            <Text style={styles.mockLabel}>Demo workspace</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

interface RailButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active: boolean;
  count?: number;
  color?: string;
  onPress: () => void;
}

function RailButton({ icon, label, active, count, color, onPress }: RailButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.railButton, active && styles.railButtonActive, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={19} color={color ?? (active ? colors.accent : colors.textSecondary)} />
      <Text numberOfLines={1} style={[styles.railButtonLabel, active && styles.railButtonLabelActive]}>{label}</Text>
      {count ? <Text style={styles.railCount}>{count}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  rail: { width: 224, padding: 16, backgroundColor: colors.chrome, borderRightWidth: 1, borderRightColor: colors.border },
  brandMark: { width: 38, height: 38, marginHorizontal: 8, marginTop: 5, marginBottom: 28, borderRadius: 12, backgroundColor: colors.accent, justifyContent: 'center', alignItems: 'center' },
  brandBubble: { width: 19, height: 15, borderRadius: 7, backgroundColor: colors.surface, transform: [{ translateX: -2 }, { translateY: -1 }] },
  brandBubbleSmall: { position: 'absolute', width: 9, height: 7, right: 7, bottom: 8, borderRadius: 4, backgroundColor: '#A9D0FF', borderWidth: 2, borderColor: colors.accent },
  navigation: { flex: 1, gap: 5 },
  sectionLabel: { marginTop: 22, marginBottom: 5, marginLeft: 10, fontSize: 11, fontWeight: '700', color: colors.textTertiary, letterSpacing: 0.8 },
  railButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 10, borderRadius: radii.small },
  railButtonActive: { backgroundColor: '#E7E9EE' },
  railButtonLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.textSecondary },
  railButtonLabelActive: { color: colors.text, fontWeight: '600' },
  railCount: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, overflow: 'hidden', backgroundColor: colors.accent, color: colors.surface, fontSize: 11, fontWeight: '700', textAlign: 'center', lineHeight: 18 },
  footer: { gap: 12 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 16 },
  profileAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#292D36', alignItems: 'center', justifyContent: 'center' },
  profileInitials: { color: colors.surface, fontSize: 11, fontWeight: '700' },
  profileCopy: { flex: 1 },
  profileName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  mockLabel: { color: colors.textTertiary, fontSize: 10, marginTop: 1 },
  pressed: { opacity: 0.72 },
});
