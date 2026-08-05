import { Ionicons } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Conversation, PeopleFilter } from '../domain/models';
import { conversationTitle } from '../domain/selectors';
import { colors, radii } from '../theme';
import { SourceMarker } from './SourceMarker';

interface ConversationListProps {
  conversations: Conversation[];
  selectedId?: string;
  selectedPeopleFilter: PeopleFilter;
  query: string;
  unreadOnly: boolean;
  compactPeoplePicker: boolean;
  onQueryChange: (query: string) => void;
  onToggleUnread: () => void;
  onSelectPeopleFilter: (filter: PeopleFilter) => void;
  onSelectConversation: (id: string) => void;
}

const filterOptions: Array<{ id: PeopleFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'direct', label: 'People' },
  { id: 'groups', label: 'Groups' },
  { id: 'favorites', label: 'Favorites' },
];

export function ConversationList(props: ConversationListProps) {
  const {
    conversations, selectedId, selectedPeopleFilter, query, unreadOnly, compactPeoplePicker,
    onQueryChange, onToggleUnread, onSelectPeopleFilter, onSelectConversation,
  } = props;

  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View>
            <Text style={styles.eyebrow}>CONVO</Text>
            <Text style={styles.title}>People</Text>
          </View>
          <Pressable accessibilityLabel="Start a new conversation" style={styles.composeButton}>
            <Ionicons name="create-outline" size={21} color={colors.accent} />
          </Pressable>
        </View>

        {compactPeoplePicker ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterPills}>
            {filterOptions.map((option) => (
              <FilterPill key={option.id} label={option.label} active={selectedPeopleFilter === option.id} onPress={() => onSelectPeopleFilter(option.id)} />
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.searchBox}>
          <Ionicons name="search" size={17} color={colors.textTertiary} />
          <TextInput
            accessibilityLabel="Search people and messages"
            value={query}
            onChangeText={onQueryChange}
            placeholder="Search people and messages"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
          />
          {query ? (
            <Pressable onPress={() => onQueryChange('')} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={17} color={colors.textTertiary} /></Pressable>
          ) : null}
        </View>

        <View style={styles.filterRow}>
          <Text style={styles.inboxLabel}>{conversations.length} unified conversations</Text>
          <Pressable onPress={onToggleUnread} style={[styles.unreadFilter, unreadOnly && styles.unreadFilterActive]}>
            <View style={[styles.unreadDot, unreadOnly && styles.unreadDotActive]} />
            <Text style={[styles.unreadFilterText, unreadOnly && styles.unreadFilterTextActive]}>Unread</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {conversations.map((conversation) => (
          <ConversationRow key={conversation.id} conversation={conversation} selected={selectedId === conversation.id} onPress={() => onSelectConversation(conversation.id)} />
        ))}
        {conversations.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={29} color={colors.textTertiary} />
            <Text style={styles.emptyTitle}>No people found</Text>
            <Text style={styles.emptyCopy}>Try another filter or search term.</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function FilterPill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.filterPill, active && styles.filterPillActive]}>
      <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ConversationRow({ conversation, selected, onPress }: { conversation: Conversation; selected: boolean; onPress: () => void }) {
  const primary = conversation.participants[0];
  const title = conversationTitle(conversation);
  const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(conversation.lastMessageAt));
  const isGroup = conversation.participants.length > 1;

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.rowPressed]}>
      <View style={styles.avatarWrap}>
        <View style={[styles.avatar, { backgroundColor: primary.avatarColor }]}><Text style={styles.avatarText}>{primary.initials}</Text></View>
        {isGroup ? <View style={[styles.avatarSmall, { backgroundColor: conversation.participants[1].avatarColor }]}><Text style={styles.avatarSmallText}>{conversation.participants[1].initials}</Text></View> : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTopline}>
          <View style={styles.senderLine}>
            {conversation.unreadCount > 0 ? <View style={styles.activeDot} /> : null}
            <Text numberOfLines={1} style={[styles.sender, conversation.unreadCount > 0 && styles.unreadText]}>{title}</Text>
          </View>
          <Text style={[styles.time, conversation.unreadCount > 0 && styles.unreadTime]}>{time}</Text>
        </View>
        <Text numberOfLines={2} style={styles.preview}>{conversation.preview}</Text>
        <View style={styles.metaRow}>
          <View accessibilityLabel={`${conversation.sourceSummary.length} sources`} style={styles.sourceStack}>
            {conversation.sourceSummary.slice(0, 4).map((source) => <SourceMarker key={source} source={source} />)}
          </View>
          <Text style={styles.identityLabel}>
            {isGroup ? `${conversation.participants.length} people` : `${primary.identities.length} identities`}
          </Text>
          {conversation.labels.slice(0, 1).map((label) => <Text key={label} style={styles.label}>{label}</Text>)}
          {conversation.starred ? <Ionicons name="star" size={12} color="#E2A321" /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: { width: 390, maxWidth: '100%', flexShrink: 0, backgroundColor: colors.surface, borderRightWidth: 1, borderRightColor: colors.border },
  header: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12, gap: 13 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  eyebrow: { color: colors.accent, fontSize: 10, letterSpacing: 1.5, fontWeight: '800', marginBottom: 2 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700', letterSpacing: -0.8 },
  composeButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' },
  filterPills: { gap: 7, paddingRight: 12 },
  filterPill: { height: 30, paddingHorizontal: 12, justifyContent: 'center', borderRadius: radii.pill, backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border },
  filterPillActive: { backgroundColor: colors.text, borderColor: colors.text },
  filterPillText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
  filterPillTextActive: { color: colors.surface },
  searchBox: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, backgroundColor: colors.chrome, borderRadius: 11 },
  searchInput: { flex: 1, color: colors.text, fontSize: 14, paddingVertical: 0, outlineStyle: 'none' } as object,
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  inboxLabel: { color: colors.textTertiary, fontSize: 11, fontWeight: '600' },
  unreadFilter: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill },
  unreadFilterActive: { backgroundColor: colors.accentSoft },
  unreadDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.textTertiary },
  unreadDotActive: { backgroundColor: colors.accent },
  unreadFilterText: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  unreadFilterTextActive: { color: colors.accent },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 8, paddingBottom: 24 },
  row: { flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingVertical: 15, borderRadius: radii.medium },
  rowSelected: { backgroundColor: colors.accentSoft },
  rowPressed: { opacity: 0.75 },
  avatarWrap: { width: 46, height: 46 },
  avatar: { width: 43, height: 43, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.surface, fontSize: 13, fontWeight: '700' },
  avatarSmall: { position: 'absolute', right: 0, bottom: 0, width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  avatarSmallText: { color: colors.surface, fontSize: 7, fontWeight: '700' },
  rowBody: { flex: 1, gap: 4 },
  rowTopline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  senderLine: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.accent },
  sender: { maxWidth: '86%', color: colors.text, fontSize: 14, fontWeight: '500' },
  unreadText: { fontWeight: '700' },
  time: { color: colors.textTertiary, fontSize: 10 },
  unreadTime: { color: colors.accent, fontWeight: '600' },
  preview: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  metaRow: { marginTop: 5, flexDirection: 'row', alignItems: 'center', gap: 7 },
  sourceStack: { flexDirection: 'row', gap: 2 },
  identityLabel: { color: colors.textTertiary, fontSize: 9, fontWeight: '600' },
  label: { color: colors.textTertiary, fontSize: 9, paddingHorizontal: 6, paddingVertical: 2, backgroundColor: colors.chrome, borderRadius: radii.pill, overflow: 'hidden' },
  empty: { paddingTop: 72, alignItems: 'center', gap: 8 },
  emptyTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
  emptyCopy: { color: colors.textSecondary, fontSize: 12 },
});
