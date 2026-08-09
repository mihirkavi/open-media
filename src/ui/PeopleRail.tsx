import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Conversation, PeopleFilter } from '../domain/models';
import { colors, radii } from '../theme';

interface PeopleRailProps {
  conversations: Conversation[];
  selectedFilter: PeopleFilter;
  onSelectFilter: (filter: PeopleFilter) => void;
  onOpenSettings: () => void;
}

const filters: Array<{ id: PeopleFilter; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'all', label: 'All conversations', icon: 'people' },
  { id: 'direct', label: 'People', icon: 'person-outline' },
  { id: 'groups', label: 'Groups', icon: 'people-outline' },
  { id: 'favorites', label: 'Favorites', icon: 'star-outline' },
];

export function PeopleRail({ conversations, selectedFilter, onSelectFilter, onOpenSettings }: PeopleRailProps) {
  const unreadCount = conversations.reduce((total, conversation) => total + conversation.unreadCount, 0);
  const favoritePeople = conversations
    .flatMap((conversation) => conversation.participants)
    .filter((person, index, people) => person.favorite && people.findIndex((candidate) => candidate.id === person.id) === index)
    .slice(0, 4);

  return (
    <View style={styles.rail}>
      <View style={styles.brandMark}>
        <View style={styles.brandBubble} />
        <View style={styles.brandBubbleSmall} />
      </View>

      <View style={styles.navigation}>
        {filters.map((filter) => (
          <RailButton
            key={filter.id}
            icon={filter.icon}
            label={filter.label}
            count={filter.id === 'all' ? unreadCount : undefined}
            active={selectedFilter === filter.id}
            onPress={() => onSelectFilter(filter.id)}
          />
        ))}

        <Text style={styles.sectionLabel}>YOUR PEOPLE</Text>
        {favoritePeople.map((person) => (
          <View key={person.id} style={styles.personRow}>
            <View style={[styles.personAvatar, { backgroundColor: person.avatarColor }]}><Text style={styles.personInitials}>{person.initials}</Text></View>
            <View style={styles.personCopy}>
              <Text style={styles.personName}>{person.name}</Text>
              <Text style={styles.identityCount}>{person.identities.length} linked identities</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.footer}>
        <View style={styles.privacyNote}>
          <Ionicons name="git-merge-outline" size={15} color={colors.textSecondary} />
          <Text style={styles.privacyText}>Identity matches always need review</Text>
        </View>
        <RailButton icon="settings-outline" label="Settings" active={false} onPress={onOpenSettings} />
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

function RailButton({ icon, label, active, count, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; active: boolean; count?: number; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={({ pressed }) => [styles.railButton, active && styles.railButtonActive, pressed && styles.pressed]}>
      <Ionicons name={icon} size={19} color={active ? colors.accent : colors.textSecondary} />
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
  personRow: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 9, paddingVertical: 7 },
  personAvatar: { width: 29, height: 29, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  personInitials: { color: colors.surface, fontSize: 9, fontWeight: '700' },
  personCopy: { flex: 1 },
  personName: { color: colors.text, fontSize: 12, fontWeight: '600' },
  identityCount: { color: colors.textTertiary, fontSize: 9, marginTop: 1 },
  footer: { gap: 10 },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 7, marginHorizontal: 8, marginBottom: 3, padding: 10, borderRadius: radii.small, backgroundColor: '#ECEEF2' },
  privacyText: { flex: 1, color: colors.textSecondary, fontSize: 9, lineHeight: 13 },
  profile: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 14 },
  profileAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#292D36', alignItems: 'center', justifyContent: 'center' },
  profileInitials: { color: colors.surface, fontSize: 11, fontWeight: '700' },
  profileCopy: { flex: 1 },
  profileName: { color: colors.text, fontSize: 13, fontWeight: '600' },
  mockLabel: { color: colors.textTertiary, fontSize: 10, marginTop: 1 },
  pressed: { opacity: 0.72 },
});
