import { Ionicons } from '@expo/vector-icons';
import { Fragment, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Conversation, Message, Person } from '../domain/models';
import { conversationTitle } from '../domain/selectors';
import { colors, radii } from '../theme';
import { sourceLabel, SourceMarker } from './SourceMarker';

interface ThreadViewProps {
  conversation?: Conversation;
  isCompact: boolean;
  onBack: () => void;
}

export function ThreadView({ conversation, isCompact, onBack }: ThreadViewProps) {
  const [draft, setDraft] = useState('');
  const title = conversation ? conversationTitle(conversation) : '';
  const identityCount = useMemo(
    () => conversation?.participants.reduce((total, person) => total + person.identities.length, 0) ?? 0,
    [conversation],
  );

  if (!conversation) {
    return (
      <View style={styles.placeholder}>
        <View style={styles.placeholderIcon}><Ionicons name="people-outline" size={27} color={colors.accent} /></View>
        <Text style={styles.placeholderTitle}>Your people, together</Text>
        <Text style={styles.placeholderCopy}>Select a person or group to open their unified timeline.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.panel} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <View style={styles.headerLeading}>
          {isCompact ? (
            <Pressable accessibilityLabel="Back to people" onPress={onBack} style={styles.iconButton}><Ionicons name="chevron-back" size={22} color={colors.accent} /></Pressable>
          ) : null}
          <View style={styles.headerAvatarStack}>
            {conversation.participants.slice(0, 2).map((person, index) => (
              <View key={person.id} style={[styles.headerAvatar, { backgroundColor: person.avatarColor, marginLeft: index ? -10 : 0, zIndex: 2 - index }]}>
                <Text style={styles.headerAvatarText}>{person.initials}</Text>
              </View>
            ))}
          </View>
          <View style={styles.headerCopy}>
            <Text numberOfLines={1} style={styles.headerTitle}>{title}</Text>
            <View style={styles.headerMeta}>
              <Text style={styles.headerSubtitle}>
                {conversation.participants.length > 1
                  ? `${conversation.participants.length} people · ${identityCount} identities`
                  : `${identityCount} linked ${identityCount === 1 ? 'identity' : 'identities'}`}
              </Text>
              <View style={styles.headerSources}>{conversation.sourceSummary.map((source) => <SourceMarker key={source} source={source} />)}</View>
            </View>
          </View>
        </View>
        <View style={styles.headerActions}>
          <Pressable accessibilityLabel="Start a call" style={styles.iconButton}><Ionicons name="call-outline" size={19} color={colors.textSecondary} /></Pressable>
          <Pressable accessibilityLabel="Person and identity details" style={styles.iconButton}><Ionicons name="person-circle-outline" size={21} color={colors.textSecondary} /></Pressable>
        </View>
      </View>

      <ScrollView style={styles.messages} contentContainerStyle={styles.messagesContent}>
        <View style={styles.personContext}>
          <Ionicons name={conversation.participants.length > 1 ? 'people-outline' : 'person-outline'} size={14} color={colors.accent} />
          <Text style={styles.personContextText}>
            {conversation.participants.length > 1
              ? `${conversation.participants.length}-person group · messages stay in this group timeline`
              : `One person · ${identityCount} reviewed identities · ${conversation.sourceSummary.length} sources`}
          </Text>
        </View>
        <Text style={styles.dateDivider}>Today</Text>
        {conversation.messages.map((message, index) => {
          const previous = conversation.messages[index - 1];
          const showTopic = Boolean(
            message.emailContext && previous?.emailContext?.providerThreadId !== message.emailContext.providerThreadId,
          );
          const sender = conversation.participants.find((person) => person.id === message.senderPersonId);
          const showSender = message.direction === 'inbound' && (index === 0 || previous.senderPersonId !== message.senderPersonId);

          return (
            <Fragment key={message.id}>
              {showTopic && message.emailContext ? <EmailTopicCard subject={message.emailContext.subject} source={message.source} /> : null}
              <MessageBubble message={message} sender={sender} showSender={showSender} />
            </Fragment>
          );
        })}
      </ScrollView>

      <View style={styles.composerWrap}>
        <View style={styles.demoNotice}>
          <Ionicons name="shield-checkmark-outline" size={13} color={colors.textTertiary} />
          <Text style={styles.demoNoticeText}>Demo mode · route choice and sending are disabled</Text>
        </View>
        <View style={styles.composer}>
          <Pressable accessibilityLabel="Choose message route" style={styles.routeButton}>
            <Ionicons name="git-branch-outline" size={14} color={colors.accent} />
            <Text style={styles.routeText}>Smart route</Text>
          </Pressable>
          <TextInput
            accessibilityLabel="Message"
            multiline
            placeholder={conversation.groupTitle ? `Message ${conversation.groupTitle}` : `Message ${conversation.participants[0].name}`}
            placeholderTextColor={colors.textTertiary}
            value={draft}
            onChangeText={setDraft}
            style={styles.composerInput}
          />
          <Pressable accessibilityLabel="Send message (demo only)" disabled={!draft.trim()} onPress={() => setDraft('')} style={[styles.sendButton, !draft.trim() && styles.sendButtonDisabled]}>
            <Ionicons name="arrow-up" size={18} color={colors.surface} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function EmailTopicCard({ subject, source }: { subject: string; source: Message['source'] }) {
  return (
    <View accessibilityLabel={`Email topic: ${subject}`} style={styles.topicCard}>
      <View style={styles.topicRule} />
      <View style={styles.topicContent}>
        <View style={styles.topicLabelRow}><Ionicons name="mail-outline" size={10} color={colors.textTertiary} /><Text style={styles.topicLabel}>EMAIL TOPIC · {sourceLabel(source)}</Text></View>
        <Text numberOfLines={1} style={styles.topicSubject}>{subject}</Text>
      </View>
      <View style={styles.topicRule} />
    </View>
  );
}

function MessageBubble({ message, sender, showSender }: { message: Message; sender?: Person; showSender: boolean }) {
  const outbound = message.direction === 'outbound';
  const time = new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(message.sentAt));

  return (
    <View style={[styles.messageGroup, outbound ? styles.messageGroupOutbound : styles.messageGroupInbound]}>
      {showSender && sender ? <Text style={styles.senderName}>{sender.name}</Text> : null}
      <View style={[styles.bubble, outbound ? styles.bubbleOutbound : styles.bubbleInbound]}>
        <Text style={[styles.messageBody, outbound && styles.messageBodyOutbound]}>{message.body}</Text>
        <View style={[styles.bubbleMeta, outbound && styles.bubbleMetaOutbound]}>
          <SourceMarker source={message.source} inverse={outbound} />
          <Text style={[styles.inlineTime, outbound && styles.inlineTimeOutbound]}>{time}</Text>
        </View>
      </View>
      {outbound ? <Text style={styles.deliveryState}>Delivered</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, minWidth: 0, backgroundColor: colors.surfaceAlt },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceAlt, gap: 10 },
  placeholderIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  placeholderTitle: { color: colors.text, fontSize: 18, fontWeight: '700' },
  placeholderCopy: { color: colors.textSecondary, fontSize: 13 },
  header: { minHeight: 74, paddingHorizontal: 18, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'rgba(255,255,255,0.96)', borderBottomWidth: 1, borderBottomColor: colors.border },
  headerLeading: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 11 },
  headerAvatarStack: { flexDirection: 'row', paddingLeft: 1 },
  headerAvatar: { width: 37, height: 37, borderRadius: 19, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.surface },
  headerAvatarText: { color: colors.surface, fontSize: 10, fontWeight: '700' },
  headerCopy: { flex: 1, minWidth: 0 },
  headerTitle: { color: colors.text, fontSize: 15, fontWeight: '700' },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 3 },
  headerSubtitle: { color: colors.textTertiary, fontSize: 10 },
  headerSources: { flexDirection: 'row', gap: 2 },
  headerActions: { flexDirection: 'row', gap: 5 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.chrome },
  messages: { flex: 1 },
  messagesContent: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 18, paddingBottom: 16 },
  personContext: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 17, paddingHorizontal: 11, paddingVertical: 6, backgroundColor: colors.accentSoft, borderRadius: radii.pill },
  personContextText: { color: colors.accent, fontSize: 9, fontWeight: '600' },
  dateDivider: { alignSelf: 'center', marginBottom: 14, color: colors.textTertiary, fontSize: 10, fontWeight: '600' },
  topicCard: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 10 },
  topicRule: { flex: 1, height: 1, backgroundColor: colors.border },
  topicContent: { maxWidth: '62%', alignItems: 'center', paddingHorizontal: 11, paddingVertical: 7, borderRadius: radii.small, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  topicLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  topicLabel: { color: colors.textTertiary, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },
  topicSubject: { color: colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 2 },
  messageGroup: { maxWidth: '78%', marginBottom: 11 },
  messageGroupInbound: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  messageGroupOutbound: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  senderName: { marginLeft: 11, marginBottom: 5, color: colors.textSecondary, fontSize: 10, fontWeight: '600' },
  bubble: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 7, borderRadius: 20 },
  bubbleInbound: { backgroundColor: '#E8E9ED', borderBottomLeftRadius: 6 },
  bubbleOutbound: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  messageBody: { color: colors.text, fontSize: 14, lineHeight: 20 },
  messageBodyOutbound: { color: colors.surface },
  bubbleMeta: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 5 },
  bubbleMetaOutbound: { alignSelf: 'flex-end' },
  inlineTime: { color: colors.textTertiary, fontSize: 8 },
  inlineTimeOutbound: { color: 'rgba(255,255,255,0.68)' },
  deliveryState: { marginTop: 3, marginRight: 7, color: colors.textTertiary, fontSize: 8 },
  composerWrap: { paddingHorizontal: 18, paddingTop: 7, paddingBottom: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  demoNotice: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 5, marginBottom: 6 },
  demoNoticeText: { color: colors.textTertiary, fontSize: 9, fontWeight: '500' },
  composer: { minHeight: 46, maxHeight: 120, flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 5, backgroundColor: colors.chrome, borderWidth: 1, borderColor: colors.border, borderRadius: 23 },
  routeButton: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, borderRadius: 17, backgroundColor: colors.accentSoft },
  routeText: { color: colors.accent, fontSize: 9, fontWeight: '700' },
  composerInput: { flex: 1, minHeight: 34, maxHeight: 100, paddingHorizontal: 2, paddingTop: Platform.OS === 'ios' ? 8 : 6, paddingBottom: 6, color: colors.text, fontSize: 14, outlineStyle: 'none' } as object,
  sendButton: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent },
  sendButtonDisabled: { backgroundColor: '#C7CAD0' },
});
