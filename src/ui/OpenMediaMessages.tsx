import { Ionicons } from "@expo/vector-icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, Image, Keyboard, Linking, Modal, Platform, Pressable, ScrollView, StyleProp, StyleSheet, TextStyle, View, useWindowDimensions } from "react-native";
import { Loader } from "./Loader";
import { PullToRefresh } from "./PullToRefresh";
import { SwipeToToggleRead } from "./SwipeToToggleRead";
import { receiptLabel, receiptOf } from "../domain/receipts";
import { PersonLink, PersonTarget, useSavedName } from "./people";
import { Text, TextInput } from "./Text";

import { bridgedSourceOf } from "../connectors/bridgesConnector";
import { attachmentURL } from "../connectors/mailApiConnector";
import { formatEmailBody } from "../domain/emailBody";
import { formatListTime, layoutThread } from "../domain/threadLayout";
import { Conversation, Message, MessageAttachment, PeopleFilter, Person } from "../domain/models";
import { encounterForConversation } from "../domain/people";
import { canReply, channelOf, defaultChannel } from "../domain/contactMerge";
import { conversationTitle, filterConversations } from "../domain/selectors";
import { ThemeColors } from "../theme";
import { useOpenMediaTheme } from "../themeContext";
import { SourceMarker, sourceLabel } from "./SourceMarker";
import type { MessageMode } from "./OpenMediaApp";
import { TranslationNote, useTranslation } from "./useTranslation";
import { VerifiedTick, verifiedBlue } from "./VerifiedTick";
import { aiPersonId, isAiConversation, maskKeys } from "../domain/aiChat";
import { parseMarkdown } from "../domain/markdown";
import { MarkdownBody } from "./MarkdownBody";
import { AiMark } from "./AiMark";
import { AiThinking } from "./AiThinking";
import { jumboEmojiCount, mediaPreview, parseMessageMedia } from "../domain/messageMedia";
import { MediaPicker } from "./MediaPicker";
import { JumboEmoji, MessageMediaView } from "./MessageMediaView";

interface Props {
  conversations: Conversation[];
  loading: boolean;
  error: string;
  messageMode: MessageMode;
  blockedUserIds: string[];
  onRetry: () => Promise<void>;
  onSend: (conversationId: string, body: string, replyTo?: Message) => Promise<void>;
  onSearchProfiles: (query: string) => Promise<Person[]>;
  onStartConversation: (personId: string) => Promise<string>;
  /** Sends a new email and returns the conversation it lands in. */
  onSendNewEmail?: (addresses: string[], body: string) => Promise<string>;
  /** The mailbox new emails are sent from, if any can send. */
  emailFrom?: string;
  emailContacts?: EmailContact[];
  /** Opens this conversation, e.g. after “Message” on someone's profile. */
  openConversationId?: string;
  /** Something asked from Search, sent in the Open Media AI chat as if typed there. */
  aiAsk?: { text: string; at: number };
  /** Pull down on the list: ask every mailbox and chat for anything new. */
  onRefresh?: () => Promise<void>;
  /** The conversation on screen has been seen: record it as read (ADR 0026). */
  onRead?: (conversation: Conversation) => void;
  /** Swiping a row right: marks it read when unread, unread when read. */
  onToggleRead?: (conversation: Conversation) => void;
  onSetBlocked: (personId: string, blocked: boolean) => Promise<void>;
  onReport: (
    conversationId: string,
    personId: string,
    messageId?: string,
  ) => Promise<void>;
}

export function OpenMediaMessages({
  conversations,
  loading,
  error,
  messageMode,
  blockedUserIds,
  onRetry,
  onSend,
  onSearchProfiles,
  onStartConversation,
  onSendNewEmail,
  emailFrom,
  emailContacts = [],
  onSetBlocked,
  onReport,
  openConversationId,
  aiAsk,
  onRefresh,
  onRead,
  onToggleRead,
}: Props) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | undefined>(openConversationId);
  useEffect(() => { if (openConversationId) setSelectedId(openConversationId); }, [openConversationId]);
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const filtered = useMemo(
    () =>
      filterConversations(
        // The open conversation stays listed after reading it clears its unread mark.
        unreadOnly ? conversations.filter((conversation) => conversation.unreadCount > 0 || conversation.id === selectedId) : conversations,
        { peopleFilter, query: "", unreadOnly: false },
      ),
    [conversations, peopleFilter, unreadOnly, selectedId],
  );
  const selected =
    // A profile's “Message” opens a person's chat by its own id, which may now be one channel of a merged conversation.
    conversations.find((conversation) => conversation.id === selectedId || conversation.channels?.some((channel) => channel.id === selectedId)) ??
    (!compact ? filtered[0] : undefined);
  // A conversation on screen is read (ADR 0026) once its latest message is from someone else.
  const latest = selected?.messages[selected.messages.length - 1];
  useEffect(() => {
    // Also when it was marked unread, even if the newest message is the person's own.
    if (selected && (latest?.direction === "inbound" || selected.unreadCount > 0)) onRead?.(selected);
    // Only when the conversation or its latest message changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, latest?.id]);
  const composing = newMessageOpen && messageMode === "open_media";
  const newMessagePanel = (
          <NewMessagePanel
            onClose={() => setNewMessageOpen(false)}
            onSearch={onSearchProfiles}
            onStart={async (personId) => {
              const id = await onStartConversation(personId);
              setSelectedId(id);
              setNewMessageOpen(false);
            }}
            onSendEmail={onSendNewEmail ? async (addresses, body) => {
              const id = await onSendNewEmail(addresses, body);
              setSelectedId(id);
              setNewMessageOpen(false);
            } : undefined}
            emailFrom={emailFrom}
            emailContacts={emailContacts}
          />
  );
  if (compact && selected && !composing)
    return (
      <MessageThread
        key={selected.id}
        conversation={selected}
        blockedUserIds={blockedUserIds}
        onBack={() => setSelectedId(undefined)}
        focusOnOpen
        ask={isAiConversation(selected) ? aiAsk : undefined}
        onSend={onSend}
        onSetBlocked={onSetBlocked}
        onReport={onReport}
      />
    );
  return (
    <View style={styles.layout}>
      <View style={[styles.list, compact && styles.listCompact]}>
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>
              {messageMode === "matrix"
                ? "Local Matrix sandbox room."
                : "Everyone you talk to, in one place."}
            </Text>
          </View>
          {messageMode === "open_media" ? (
            <View style={styles.headingActions}>
              {/* Unread only, as an envelope with a dot like Apple Mail's; filled while it's on. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Unread only"
                accessibilityState={{ selected: unreadOnly }}
                onPress={() => setUnreadOnly((value) => !value)}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.unreadButton, unreadOnly && styles.unreadButtonActive, (hovered || pressed) && !unreadOnly && styles.unreadButtonHover]}
              >
                <Ionicons
                  name={unreadOnly ? "mail-unread" : "mail-unread-outline"}
                  size={19}
                  color={unreadOnly ? colors.surface : colors.text}
                />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="New message"
                onPress={() => setNewMessageOpen(true)}
                style={styles.newButton}
              >
                <Ionicons
                  name="create-outline"
                  size={20}
                  color={colors.surface}
                />
              </Pressable>
            </View>
          ) : (
            <View style={styles.matrixBadge}>
              <Ionicons name="git-network-outline" size={14} color="#0D9488" />
              <Text style={styles.matrixBadgeText}>MATRIX</Text>
            </View>
          )}
        </View>
        {composing && compact ? (
          newMessagePanel
        ) : <>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterBar}
          contentContainerStyle={styles.filters}
        >
          {(["all", "direct", "groups", "favorites"] as const).map(
            (filter) => (
              <Pressable
                key={filter}
                accessibilityRole="button"
                accessibilityState={{ selected: peopleFilter === filter }}
                onPress={() => setPeopleFilter(filter)}
                style={[
                  styles.chip,
                  peopleFilter === filter && styles.chipActive,
                ]}
              >
                <Text
                  style={[
                    styles.chipText,
                    peopleFilter === filter && styles.chipTextActive,
                  ]}
                >
                  {filter === "direct" ? "People" : capitalize(filter)}
                </Text>
              </Pressable>
            ),
          )}
        </ScrollView>
        {loading ? (
          <View style={styles.center}>
            <Loader color={colors.text} />
            <Text style={styles.statusText}>Loading conversations…</Text>
          </View>
        ) : error ? (
          <View style={styles.center}>
            <Ionicons
              name="cloud-offline-outline"
              size={24}
              color={colors.textSecondary}
            />
            <Text accessibilityLiveRegion="assertive" style={styles.error}>
              {error}
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={onRetry}
              style={styles.emptyAction}
            >
              <Text style={styles.emptyActionText}>Try again</Text>
            </Pressable>
          </View>
        ) : filtered.length ? (
          <PullToRefresh onRefresh={onRefresh}>
            {filtered.map((conversation) => (
              <SwipeToToggleRead
                key={conversation.id}
                unread={conversation.unreadCount > 0}
                onToggle={onToggleRead && !isAiConversation(conversation) && conversation.messages.length ? () => onToggleRead(conversation) : undefined}
              >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${conversationTitle(conversation)}. ${listPreview(conversation.preview)}`}
                onPress={() => setSelectedId(conversation.id)}
                style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                  styles.row,
                  onToggleRead && !isAiConversation(conversation) && conversation.messages.length ? styles.rowInSwipe : null,
                  (hovered || pressed) && styles.rowHover,
                  selected?.id === conversation.id && styles.rowActive,
                ]}
              >
                <ConversationAvatar people={conversation.participants} size={48} />
                <View style={styles.rowCopy}>
                  <View style={styles.rowTitleLine}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {conversationTitle(conversation)}
                    </Text>
                    {conversation.participants[0]?.verifiedDomain ? <VerifiedBadge domain={conversation.participants[0].verifiedDomain} /> : null}
                    {!conversation.groupTitle && conversation.participants[0]?.verified ? <VerifiedTick /> : null}
                    {conversation.unreadCount ? (
                      <View style={styles.unread} />
                    ) : null}
                    {conversation.messages[0]?.id === "ai:welcome" ? null : <Text numberOfLines={1} style={styles.rowTime}>{formatListTime(new Date(conversation.lastMessageAt))}</Text>}
                  </View>
                  {conversation.channels ? (
                    <View style={styles.previewLine}>
                      <SourceMarker source={conversation.messages[conversation.messages.length - 1]?.source ?? conversation.sourceSummary[0]} />
                      <Text numberOfLines={2} style={[styles.preview, styles.previewShrink]}>{listPreview(conversation.preview)}</Text>
                    </View>
                  ) : (
                    <Text numberOfLines={2} style={styles.preview}>
                      {listPreview(conversation.preview)}
                    </Text>
                  )}
                </View>
              </Pressable>
              </SwipeToToggleRead>
            ))}
          </PullToRefresh>
        ) : unreadOnly && conversations.length ? (
          // Empty lists can be pulled too: that is when people check for new mail.
          <PullToRefresh onRefresh={onRefresh} style={styles.pullEmpty} contentContainerStyle={styles.pullEmptyContent}>
          <View style={styles.center}>
            <Ionicons name="checkmark-done-outline" size={28} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>You’re all caught up</Text>
            <Text style={styles.statusText}>No unread messages or email.</Text>
          </View>
          </PullToRefresh>
        ) : (
          <PullToRefresh onRefresh={onRefresh} style={styles.pullEmpty} contentContainerStyle={styles.pullEmptyContent}>
          <View style={styles.center}>
            <Ionicons
              name="chatbubbles-outline"
              size={28}
              color={colors.textSecondary}
            />
            <Text style={styles.emptyTitle}>
              {messageMode === "matrix"
                ? "No joined Matrix rooms yet"
                : "Start your first conversation"}
            </Text>
            <Text style={styles.statusText}>
              {messageMode === "matrix"
                ? "Join a room on the configured Matrix account, then refresh."
                : "Find another Open Media tester by name or handle."}
            </Text>
            {messageMode === "open_media" ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => setNewMessageOpen(true)}
                style={styles.emptyAction}
              >
                <Text style={styles.emptyActionText}>New message</Text>
              </Pressable>
            ) : null}
          </View>
          </PullToRefresh>
        )}
        </>}
      </View>
      {!compact ? (
        <View style={styles.threadPane}>
          {composing ? (
            // Like Messages on a Mac, a new message takes the conversation pane.
            newMessagePanel
          ) : selected ? (
            <MessageThread
              key={selected.id}
              conversation={selected}
              blockedUserIds={blockedUserIds}
              focusOnOpen={selected.id === selectedId}
              ask={isAiConversation(selected) ? aiAsk : undefined}
              onSend={onSend}
              onSetBlocked={onSetBlocked}
              onReport={onReport}
            />
          ) : (
            <View style={styles.center}>
              <Text style={styles.statusText}>Choose a conversation.</Text>
            </View>
          )}
        </View>
      ) : null}
    </View>
  );
}

/** One line of composer text; the field grows in these steps. */
const composerLineHeight = 22;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => undefined);
    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => subscription.remove();
  }, []);
  return reduced;
}

/** The composer's height: one line, growing with the text up to six, and shrinking back. */
function useComposerHeight(input: React.RefObject<TextInput | null>, value: string) {
  const [inputHeight, setInputHeight] = useState(composerLineHeight);
  const fitComposer = (height: number) => setInputHeight(Math.min(Math.max(height, composerLineHeight), composerLineHeight * 6));
  // A web text box never reports shrinking, so measure it from zero whenever the text changes.
  useLayoutEffect(() => {
    const node = input.current as unknown as HTMLTextAreaElement | null;
    if (Platform.OS !== "web" || !node?.style) return;
    const previous = node.style.height;
    node.style.height = "0px";
    fitComposer(node.scrollHeight);
    node.style.height = previous;
  }, [value]);
  return { inputHeight, fitComposer };
}

/** A new message rises and fades in, the way chat apps show arrivals. */
function Appear({ animate, style, children }: React.PropsWithChildren<{ animate: boolean; style: object }>) {
  const progress = useRef(new Animated.Value(animate ? 0 : 1)).current;
  useEffect(() => {
    if (!animate) return;
    Animated.timing(progress, { toValue: 1, duration: 280, easing: Easing.bezier(0.2, 0.8, 0.2, 1), useNativeDriver: Platform.OS !== "web" }).start();
  }, []);
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** The send button wakes up with a small spring once there is something to send. */
function SendButton({ ready, reduceMotion, onPress }: { ready: boolean; reduceMotion: boolean; onPress: () => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const progress = useRef(new Animated.Value(ready ? 1 : 0)).current;
  useEffect(() => {
    const native = Platform.OS !== "web";
    if (reduceMotion) progress.setValue(ready ? 1 : 0);
    else Animated.spring(progress, { toValue: ready ? 1 : 0, speed: 22, bounciness: 9, useNativeDriver: native }).start();
  }, [ready, reduceMotion]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Send message" accessibilityState={{ disabled: !ready }} disabled={!ready} onPress={onPress}>
      {({ pressed }) => (
        <Animated.View
          style={[
            styles.send,
            {
              opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0.28, 1] }),
              transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.86, pressed ? 0.92 : 1] }) }],
            },
          ]}
        >
          <Ionicons name="arrow-up" size={19} color={colors.surface} />
        </Animated.View>
      )}
    </Pressable>
  );
}

interface PendingMessage { id: string; threadId: string; conversationId: string; body: string; replyTo?: Message; failed?: string }

function MessageThread({
  conversation,
  blockedUserIds,
  onBack,
  focusOnOpen,
  ask,
  onSend,
  onSetBlocked,
  onReport,
}: {
  conversation: Conversation;
  blockedUserIds: string[];
  onBack?: () => void;
  ask?: { text: string; at: number };
  /** Put the cursor in the reply box when the conversation was chosen, so typing can start at once. */
  focusOnOpen?: boolean;
  onSend: (conversationId: string, body: string, replyTo?: Message) => Promise<void>;
  onSetBlocked: (personId: string, blocked: boolean) => Promise<void>;
  onReport: (
    conversationId: string,
    personId: string,
    messageId?: string,
  ) => Promise<void>;
}) {
  // iOS doesn't resize the window for the keyboard: lift the composer by exactly the part of
  // this thread the keyboard covers (the app header and tab bar make a fixed offset unreliable).
  const threadRef = useRef<View>(null);
  const keyboardInset = useKeyboardInset(threadRef);
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  // Messages show the moment you send them, like a chat, and leave once the real one arrives.
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyStatus, setSafetyStatus] = useState("");
  // Like iMessage, a thread opens at the newest message.
  const threadScroll = useRef<ScrollView>(null);
  // A person's merged conversation (ADR 0023) replies through one of its channels: by default the
  // one they last wrote from. Everything about sending below follows that channel.
  const [channelId, setChannelId] = useState(() => defaultChannel(conversation).id);
  const [choosingChannel, setChoosingChannel] = useState(false);
  const via = channelOf(conversation, channelId) ?? defaultChannel(conversation);
  const channels = conversation.channels ?? [];
  const blocked = via.participants.some((person) => blockedUserIds.includes(person.id));
  const canSend = !blocked && canReply(via);
  const throughMatrix = via.sourceSummary.includes("matrix");
  // WhatsApp and other bridged networks (ADR 0011).
  const bridged = bridgedSourceOf(via);
  const bridgedName = bridged ? sourceLabel(bridged) : "";
  const otherPerson = conversation.participants[0];
  // Blocking and reports are about the Open Media account in this channel.
  const channelPerson = via.participants[0];
  const reportableMessage = [...conversation.messages]
    .reverse()
    .find(
      (message) =>
        message.direction === "inbound" &&
        (!channels.length || message.conversationId === via.id) &&
        message.senderPersonId === channelPerson?.id,
    );
  const [replyTo, setReplyTo] = useState<Message>();
  const composerInput = useRef<TextInput>(null);
  // Not on touch screens, where the keyboard would cover the conversation being opened.
  useEffect(() => {
    if (!focusOnOpen || !canSend || Platform.OS !== "web" || window.matchMedia?.("(pointer: coarse)").matches) return;
    const timer = setTimeout(() => composerInput.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [focusOnOpen, canSend]);
  const startReply = (message: Message) => {
    setReplyTo(message);
    // Replying to a message answers it where it came from.
    if (channelOf(conversation, message.conversationId) && message.conversationId !== via.id) setChannelId(message.conversationId);
    setTimeout(() => composerInput.current?.focus(), 0);
  };
  const byId = useMemo(() => new Map(conversation.messages.map((message) => [message.id, message])), [conversation.messages]);
  const isGroup = conversation.participants.length > 1;
  const senderOf = (message: Message) => conversation.participants.find((person) => person.id === message.senderPersonId) ?? otherPerson;
  const senderLabel = (message: Message) => message.direction === "outbound" ? "You" : (senderOf(message)?.name ?? "Them");
  const lastOutboundId = [...conversation.messages].reverse().find((message) => message.direction === "outbound")?.id;
  const deliver = async (item: PendingMessage) => {
    setPending((items) => items.map((other) => (other.id === item.id ? { ...other, failed: undefined } : other)));
    try {
      await onSend(item.conversationId, item.body, item.replyTo);
      setPending((items) => items.filter((other) => other.id !== item.id));
    } catch (reason) {
      const failed = reason instanceof Error ? reason.message : "Message could not be sent.";
      setPending((items) => items.map((other) => (other.id === item.id ? { ...other, failed } : other)));
    }
  };
  const send = (text: string) => {
    // A quote only threads within its own channel.
    const item: PendingMessage = { id: `pending-${Date.now()}`, threadId: conversation.id, conversationId: via.id, body: text, replyTo: replyTo?.conversationId === via.id || !channels.length ? replyTo : undefined };
    // The stored copy replaces this bubble in place, without moving in a second time.
    sentBodies.add(item.body);
    setReplyTo(undefined);
    setPending((items) => [...items, item]);
    deliver(item);
  };
  const submit = () => {
    if (!body.trim()) return;
    send(body.trim());
    setBody("");
  };
  // Emoji, GIFs and stickers (ADR 0029). An emoji goes in where the cursor is; a GIF or sticker
  // sends at once, and what you were typing stays in the box.
  const [pickerOpen, setPickerOpen] = useState(false);
  const compactThread = useWindowDimensions().width < 760;
  const selection = useRef({ start: 0, end: 0 });
  const insertEmoji = (emoji: string) => {
    const start = Math.min(selection.current.start, body.length);
    const end = Math.min(Math.max(selection.current.end, start), body.length);
    const next = body.slice(0, start) + emoji + body.slice(end);
    const caret = start + emoji.length;
    selection.current = { start: caret, end: caret };
    setBody(next);
    // On the web the cursor stays after the emoji, so a run of them reads in order.
    if (Platform.OS === "web") requestAnimationFrame(() => (composerInput.current as unknown as { setSelectionRange?: (a: number, b: number) => void } | null)?.setSelectionRange?.(caret, caret));
  };
  const togglePicker = () => {
    setPickerOpen((open) => {
      // On phones the panel takes the keyboard's place, and the keyboard comes back with it closed.
      if (Platform.OS !== "web") {
        if (open) setTimeout(() => composerInput.current?.focus(), 0);
        else Keyboard.dismiss();
      }
      return !open;
    });
  };
  // A question asked from Search arrives here once and is sent like a typed message.
  const asked = useRef(0);
  useEffect(() => {
    if (!ask || ask.at === asked.current || !ask.text.trim()) return;
    asked.current = ask.at;
    const item: PendingMessage = { id: `pending-${ask.at}`, threadId: conversation.id, conversationId: conversation.id, body: ask.text.trim() };
    sentBodies.add(item.body);
    setPending((items) => [...items, item]);
    deliver(item);
    // deliver only reads the latest props through onSend.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask?.at]);
  const waiting = pending.filter((item) => item.threadId === conversation.id);
  // A message you just sent (and Open Media AI's drawing while it answers) scroll into view at once.
  useEffect(() => {
    if (!waiting.length) return;
    const timer = setTimeout(() => threadScroll.current?.scrollToEnd({ animated: !reduceMotion }), 60);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting.length]);
  // Only messages that arrive while the thread is open move in; the history is already there.
  const reduceMotion = useReducedMotion();
  const openedWith = useRef(new Set(conversation.messages.map((message) => message.id))).current;
  const sentBodies = useRef(new Set<string>()).current;
  const arrives = (message: Message) =>
    !reduceMotion && !openedWith.has(message.id) && !(message.direction === "outbound" && sentBodies.has(message.body.trim()));
  const scrolledOnce = useRef(false);
  const { inputHeight, fitComposer } = useComposerHeight(composerInput, body);
  const [focused, setFocused] = useState(false);
  // On the web, Enter sends and Shift+Enter starts a new line, like other chat apps.
  const onComposerKey = (event: { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean }; preventDefault: () => void }) => {
    const { key, shiftKey, isComposing } = event.nativeEvent;
    if (key === "Escape" && pickerOpen) setPickerOpen(false);
    if (Platform.OS === "web" && key === "Enter" && !shiftKey && !isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <View ref={threadRef} style={[styles.thread, keyboardInset ? { paddingBottom: keyboardInset } : null]}>
      <View style={styles.threadHeader}>
        {onBack ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to messages"
            onPress={onBack}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={22} color={colors.text} />
          </Pressable>
        ) : null}
        <PersonLink target={threadTarget(conversation, otherPerson)} label={`Open ${conversationTitle(conversation)}’s profile`} style={styles.threadHeadingLink}>
        <View style={styles.threadHeading}>
          <ConversationAvatar people={conversation.participants} size={44} />
          <View style={[styles.rowTitleLine, styles.threadNameLine]}>
            <Text numberOfLines={1} style={styles.threadTitle}>
              {conversationTitle(conversation)}
            </Text>
            {otherPerson?.verifiedDomain ? <VerifiedBadge domain={otherPerson.verifiedDomain} /> : null}
            {otherPerson?.verified ? <VerifiedTick /> : null}
          </View>
          <Text numberOfLines={1} style={styles.threadMeta}>
            {channels.length
              ? channelsMeta(channels)
              : blocked
              ? "Blocked · messaging paused"
              : isAiConversation(conversation)
              ? "Every AI you use, in one chat · private to you"
              : bridged
              ? `${bridgedName} · through Open Media’s chat bridge`
              : throughMatrix
              ? "Matrix · local development sandbox"
              : conversation.email
                ? emailMeta(conversation, otherPerson)
                : canSend
                  ? "Open Media · private to conversation members"
                  : "Imported conversation · reply unavailable"}
          </Text>
        </View>
        </PersonLink>
        {channelPerson &&
        !conversation.groupTitle &&
        via.sourceSummary.includes("open_media") ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Conversation safety"
            onPress={() => {
              setSafetyStatus("");
              setSafetyOpen(true);
            }}
            style={styles.back}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        ref={threadScroll}
        contentContainerStyle={styles.threadContent}
        onContentSizeChange={() => {
          threadScroll.current?.scrollToEnd({ animated: scrolledOnce.current && !reduceMotion });
          scrolledOnce.current = true;
        }}
      >
        {conversation.messages.length || waiting.length ? (
          layoutThread(conversation.messages).map((item) =>
            item.kind === "time" ? (
              <Text key={item.key} style={styles.timeSeparator}>
                {item.label}
              </Text>
            ) : (
              <Appear
                key={item.key}
                animate={arrives(item.message)}
                style={[
                  styles.messageWrap,
                  item.message.direction === "outbound" && styles.outboundWrap,
                  item.groupStart && styles.groupStart,
                ]}
              >
                {isGroup && item.groupStart && item.message.direction === "inbound" ? (
                  <Text numberOfLines={1} style={styles.groupSender}>{senderLabel(item.message)}</Text>
                ) : null}
                <ReplyableBubble
                  outbound={item.message.direction === "outbound"}
                  enabled={canSend && !item.message.ai}
                  onReply={() => startReply(item.message)}
                  style={artOf(item.message) ? styles.bareBubble : [
                    styles.bubble,
                    item.message.direction === "outbound" && styles.outboundBubble,
                    item.groupEnd && (item.message.direction === "outbound" ? styles.outboundTail : styles.inboundTail),
                  ]}
                >
                  {item.message.replyToMessageId && byId.get(item.message.replyToMessageId) ? (
                    <View style={[styles.quote, item.message.direction === "outbound" && !artOf(item.message) && styles.quoteOutbound]}>
                      <Text style={[styles.quoteName, item.message.direction === "outbound" && !artOf(item.message) && styles.quoteNameOutbound]}>
                        {senderLabel(byId.get(item.message.replyToMessageId)!)}
                      </Text>
                      <Text numberOfLines={2} style={[styles.quoteText, item.message.direction === "outbound" && !artOf(item.message) && styles.quoteTextOutbound]}>
                        {quoteText(byId.get(item.message.replyToMessageId)!)}
                      </Text>
                    </View>
                  ) : null}
                  {item.subject ? (
                    <Text
                      style={[
                        styles.bubbleSubject,
                        item.message.direction === "outbound" && styles.outboundMessage,
                      ]}
                    >
                      {item.subject}
                    </Text>
                  ) : null}
                  {item.message.channel === "email" ? (
                    <EmailBody message={item.message} />
                  ) : artOf(item.message) ? (
                    <MessageArt art={artOf(item.message)!} outbound={item.message.direction === "outbound"} />
                  ) : (
                    <MessageText
                      message={item.message}
                      style={[
                        styles.message,
                        item.message.direction === "outbound" && styles.outboundMessage,
                      ]}
                    />
                  )}
                </ReplyableBubble>
                <MessageMedia message={item.message} />
                {item.message.ai?.byline ? (
                  <View style={[styles.aiByline, item.message.direction === "outbound" && styles.outboundWrap]}>
                    {item.message.ai.search ? <Ionicons name="search" size={11} color={colors.textTertiary} /> : <AiMark size={11} color={colors.textTertiary} />}
                    <Text numberOfLines={2} style={styles.aiBylineText}>{item.message.ai.byline}</Text>
                  </View>
                ) : null}
                {/* Receipts under your messages: a tick per group, and words under the latest one. */}
                {item.message.direction === "outbound" && (item.groupEnd || item.message.id === lastOutboundId) ? (
                  <ReceiptLine message={item.message} withLabel={item.message.id === lastOutboundId} />
                ) : null}
                {item.groupEnd && (conversation.sourceSummary.length > 1 || channels.length > 1) ? (
                  <View style={[styles.bubbleSource, item.message.direction === "outbound" && styles.outboundWrap]}>
                    <SourceMarker source={item.message.source} showLabel />
                  </View>
                ) : null}
              </Appear>
            ),
          ).concat(
            waiting.map((item) => (
              <Appear key={item.id} animate={!reduceMotion} style={[styles.messageWrap, styles.outboundWrap, styles.groupStart]}>
                <View style={[artOfBody(item.body) ? styles.bareBubble : [styles.bubble, styles.outboundBubble, styles.outboundTail], item.failed ? styles.failedBubble : !isAiConversation(conversation) && styles.sendingBubble]}>
                  {item.replyTo ? (
                    <View style={[styles.quote, !artOfBody(item.body) && styles.quoteOutbound]}>
                      <Text style={[styles.quoteName, !artOfBody(item.body) && styles.quoteNameOutbound]}>{senderLabel(item.replyTo)}</Text>
                      <Text numberOfLines={2} style={[styles.quoteText, !artOfBody(item.body) && styles.quoteTextOutbound]}>{quoteText(item.replyTo)}</Text>
                    </View>
                  ) : null}
                  {artOfBody(item.body) ? (
                    <MessageArt art={artOfBody(item.body)!} outbound />
                  ) : (
                    <Text style={[styles.message, styles.outboundMessage]}>{isAiConversation(conversation) ? maskKeys(item.body) : item.body}</Text>
                  )}
                </View>
                {item.failed ? (
                  <Pressable accessibilityRole="button" accessibilityHint={item.failed} onPress={() => deliver(item)} style={styles.deliveryLine}>
                    <Ionicons name="alert-circle" size={13} color={colors.danger} />
                    <Text accessibilityLiveRegion="assertive" style={styles.deliveryFailed}>Not sent. Tap to try again.</Text>
                  </Pressable>
                ) : (
                  <Text style={styles.deliveryStatus}>{isAiConversation(conversation) ? "Sent" : "Sending…"}</Text>
                )}
              </Appear>
            )),
          ).concat(
            // While Open Media AI works on an answer, its own drawing waits in its place.
            isAiConversation(conversation) && waiting.some((item) => !item.failed) ? [
              <Appear key="ai-thinking" animate={!reduceMotion} style={[styles.messageWrap, styles.groupStart]}>
                <View accessibilityLabel="Open Media AI is writing" accessibilityLiveRegion="polite" style={[styles.bubble, styles.inboundTail, styles.aiThinkingBubble]}>
                  <AiThinking color={colors.text} />
                </View>
              </Appear>,
            ] : [],
          )
        ) : (
          <View style={styles.threadEmpty}>
            <Text style={styles.emptyTitle}>Say hello</Text>
            <Text style={styles.statusText}>
              Messages you send here are delivered through{" "}
              {bridged ? bridgedName : throughMatrix ? "Matrix" : "Open Media"}.
            </Text>
          </View>
        )}
      </ScrollView>
      {channels.length > 1 ? (
        <View style={styles.channelBar}>
          {choosingChannel ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.channelChoices}>
              {channels.map((channel) => (
                <Pressable
                  key={channel.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: channel.id === via.id, disabled: !canReply(channel) }}
                  accessibilityLabel={`Reply ${channelLabel(channel, true)}`}
                  disabled={!canReply(channel)}
                  onPress={() => { setChannelId(channel.id); setChoosingChannel(false); setReplyTo(undefined); composerInput.current?.focus(); }}
                  style={[styles.channelChoice, channel.id === via.id && styles.channelChoiceActive, !canReply(channel) && styles.channelChoiceOff]}
                >
                  <SourceMarker source={channelSource(channel)} inverse={channel.id === via.id} />
                  <Text numberOfLines={1} style={[styles.channelChoiceText, channel.id === via.id && styles.channelChoiceTextActive]}>{channelLabel(channel)}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Replying ${channelLabel(via, true)}. Change`}
              onPress={() => setChoosingChannel(true)}
              style={styles.channelCurrent}
            >
              <SourceMarker source={channelSource(via)} />
              <Text numberOfLines={1} style={styles.channelCurrentText}>{channelLabel(via, true)}</Text>
              <Ionicons name="chevron-down" size={12} color={colors.textTertiary} />
            </Pressable>
          )}
        </View>
      ) : null}
      {canSend ? (
        <View style={styles.composerWrap}>
          {pickerOpen ? (
            <MediaPicker
              compact={compactThread}
              emojiOnly={isAiConversation(conversation)}
              onEmoji={insertEmoji}
              onMedia={(url) => { send(url); if (compactThread) setPickerOpen(false); }}
            />
          ) : null}
          {replyTo ? (
            <View style={styles.replyBanner}>
              <View style={styles.replyBar} />
              <View style={styles.replyBannerCopy}>
                <Text style={styles.replyBannerTitle}>Replying to {senderLabel(replyTo)}</Text>
                <Text numberOfLines={1} style={styles.replyBannerText}>{quoteText(replyTo)}</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Cancel reply" onPress={() => setReplyTo(undefined)} style={styles.replyCancel}>
                <Ionicons name="close" size={18} color={colors.textSecondary} />
              </Pressable>
            </View>
          ) : null}
          <View style={[styles.composer, styles.composerWithTools, (focused || pickerOpen) && styles.composerFocused]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={pickerOpen ? "Close emoji, GIFs and stickers" : "Emoji, GIFs and stickers"}
              accessibilityState={{ expanded: pickerOpen }}
              onPress={togglePicker}
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.mediaToggle, (hovered || pickerOpen) && styles.mediaToggleOn, pressed && styles.mediaTogglePressed]}
            >
              <Ionicons name={pickerOpen && Platform.OS !== "web" ? "chatbox-ellipses-outline" : "happy-outline"} size={22} color={pickerOpen ? colors.text : colors.textSecondary} />
            </Pressable>
            <TextInput
              ref={composerInput}
              accessibilityLabel="Message"
              accessibilityHint={Platform.OS === "web" ? "Enter sends; Shift+Enter adds a line" : undefined}
              maxLength={8000}
              multiline
              value={body}
              onChangeText={setBody}
              onKeyPress={onComposerKey}
              onSelectionChange={(event) => { selection.current = event.nativeEvent.selection; }}
              onFocus={() => { setFocused(true); if (Platform.OS !== "web") setPickerOpen(false); }}
              onBlur={() => setFocused(false)}
              // Grows with what you type, from one line up to six.
              onContentSizeChange={(event) => Platform.OS !== "web" && fitComposer(event.nativeEvent.contentSize.height)}
              placeholder={
                via.email
                  ? "Reply by email"
                  : bridged
                    ? `Message on ${bridgedName}`
                    : throughMatrix
                    ? "Message through Matrix"
                    : "Message"
              }
              placeholderTextColor={colors.textTertiary}
              style={[styles.composerInput, { height: inputHeight }]}
            />
            <SendButton ready={Boolean(body.trim())} reduceMotion={reduceMotion} onPress={submit} />
          </View>
        </View>
      ) : (
        <View style={styles.disabledComposer}>
          <Ionicons
            name="lock-closed-outline"
            size={15}
            color={colors.textTertiary}
          />
          <Text style={styles.disabledText}>
            {blocked
              ? "Unblock this person to send or receive new messages."
              : via.email
                ? "Add outgoing mail (SMTP) to this mailbox in Settings → Connections to reply from here."
                : "This provider does not offer a working send capability yet."}
          </Text>
        </View>
      )}
      <Modal
        visible={safetyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setSafetyOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Conversation safety</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={() => setSafetyOpen(false)}
                style={styles.close}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.safetyCopy}>
              Blocking is reversible and immediately prevents both people from
              sending new Open Media messages.
            </Text>
            {safetyStatus ? (
              <Text accessibilityLiveRegion="polite" style={styles.safetyStatus}>
                {safetyStatus}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={async () => {
                if (!channelPerson) return;
                setBusy(true);
                setSafetyStatus("");
                try {
                  await onSetBlocked(channelPerson.id, !blocked);
                  setSafetyStatus(
                    blocked ? "Person unblocked." : "Person blocked.",
                  );
                } catch (reason) {
                  setSafetyStatus(
                    reason instanceof Error
                      ? reason.message
                      : "Could not update the block.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              style={styles.safetyAction}
            >
              <Text style={styles.safetyActionText}>
                {blocked ? "Unblock person" : "Block person"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={async () => {
                if (!channelPerson) return;
                setBusy(true);
                setSafetyStatus("");
                try {
                  await onReport(
                    via.id,
                    channelPerson.id,
                    reportableMessage?.id,
                  );
                  setSafetyStatus("Report submitted for review.");
                } catch (reason) {
                  setSafetyStatus(
                    reason instanceof Error
                      ? reason.message
                      : "Could not submit the report.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
              style={styles.reportAction}
            >
              <Text style={styles.reportActionText}>
                Report unwanted contact
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/** Find someone on Open Media, right in the conversation list (no pop-up). */
/** Someone you have emailed with, offered in the To field. */
export interface EmailContact {
  address: string;
  name: string;
  initials: string;
  avatarUrls: string[];
}

const emailPattern = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;

/**
 * New message, like iMessage: a To field that takes names, @handles and email addresses as
 * chips, suggestions as you type, and the message box underneath. Open Media people open their
 * chat; email recipients (one, or several for a group) get a new email from your mailbox.
 */
function NewMessagePanel({
  onClose,
  onSearch,
  onStart,
  onSendEmail,
  emailFrom,
  emailContacts,
}: {
  onClose: () => void;
  onSearch: (query: string) => Promise<Person[]>;
  onStart: (personId: string) => Promise<void>;
  onSendEmail?: (addresses: string[], body: string) => Promise<void>;
  emailFrom?: string;
  emailContacts: EmailContact[];
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reduceMotion = useReducedMotion();
  const [query, setQuery] = useState("");
  const [recipients, setRecipients] = useState<Array<{ address: string; name: string }>>([]);
  const [results, setResults] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [body, setBody] = useState("");
  const toInput = useRef<TextInput>(null);
  const bodyInput = useRef<TextInput>(null);
  const { inputHeight, fitComposer } = useComposerHeight(bodyInput, body);
  const typed = query.trim().replace(/[,;]$/, "");
  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      // Open Media profiles; not for something that is clearly an email address.
      if (typed.length < 2 || typed.includes("@") && !typed.startsWith("@")) {
        setResults([]);
        setBusy(false);
        return;
      }
      setBusy(true);
      setError("");
      onSearch(typed)
        .then((people) => active && setResults(people))
        .catch((reason) => active && setError(reason instanceof Error ? reason.message : "Search failed."))
        .finally(() => active && setBusy(false));
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [typed, onSearch]);
  const chosen = new Set(recipients.map((recipient) => recipient.address));
  const lower = typed.toLowerCase();
  const contacts = typed
    ? emailContacts.filter((contact) => !chosen.has(contact.address) && (contact.address.includes(lower) || folded(contact.name).includes(folded(typed)))).slice(0, 6)
    : [];
  const typedAddress = emailPattern.test(typed) && !chosen.has(typed.toLowerCase()) && !contacts.some((contact) => contact.address === typed.toLowerCase()) ? typed.toLowerCase() : undefined;
  // A typed address you've emailed before shows that person's name.
  const addRecipient = (address: string, name = emailContacts.find((contact) => contact.address === address)?.name ?? address) => {
    setRecipients((list) => (list.some((item) => item.address === address) ? list : [...list, { address, name }]));
    setQuery("");
    setError("");
    toInput.current?.focus();
  };
  const onToKey = (event: { nativeEvent: { key: string }; preventDefault: () => void }) => {
    const { key } = event.nativeEvent;
    if ((key === "Enter" || key === "Tab") && emailPattern.test(typed)) {
      event.preventDefault();
      addRecipient(typed.toLowerCase());
    } else if (key === "Enter" && contacts[0]) {
      event.preventDefault();
      addRecipient(contacts[0].address, contacts[0].name);
    } else if (key === "Enter" && recipients.length) {
      event.preventDefault();
      bodyInput.current?.focus();
    } else if (key === "Backspace" && !query && recipients.length) {
      setRecipients((list) => list.slice(0, -1));
    }
  };
  const send = async () => {
    const addresses = [...recipients.map((recipient) => recipient.address), ...(typedAddress ? [typedAddress] : [])];
    if (!addresses.length || !body.trim() || !onSendEmail || sending) return;
    setSending(true);
    setError("");
    try {
      await onSendEmail(addresses, body.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The email could not be sent.");
      setSending(false);
    }
  };
  const onBodyKey = (event: { nativeEvent: { key: string; shiftKey?: boolean; isComposing?: boolean }; preventDefault: () => void }) => {
    const { key, shiftKey, isComposing } = event.nativeEvent;
    if (Platform.OS === "web" && key === "Enter" && !shiftKey && !isComposing) {
      event.preventDefault();
      send();
    }
  };
  const writing = recipients.length > 0;
  const suggestions = Boolean(typed) && (contacts.length || typedAddress || results.length || busy);
  return (
    <View style={styles.newPanel}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>New message</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>
      <Pressable accessible={false} onPress={() => toInput.current?.focus()} style={styles.toField}>
        <Text style={styles.toLabel}>To:</Text>
        {recipients.map((recipient) => (
          <Appear key={recipient.address} animate={!reduceMotion} style={styles.recipientChip}>
            <Text numberOfLines={1} style={styles.recipientName}>{recipient.name}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${recipient.name}`}
              hitSlop={8}
              onPress={() => setRecipients((list) => list.filter((item) => item.address !== recipient.address))}
            >
              <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
            </Pressable>
          </Appear>
        ))}
        <TextInput
          ref={toInput}
          accessibilityLabel="To"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          // The email keyboard on phones. Not on the web: an email-type field strips the spaces that separate addresses.
          keyboardType={Platform.OS === "web" ? "default" : "email-address"}
          value={query}
          onChangeText={(value) => {
            // An address followed by a space, comma or semicolon becomes a chip, as in Mail; this
            // also takes several pasted addresses. Phone keyboards don't report keys, so read the text.
            let rest = value;
            let match: RegExpMatchArray | null;
            const added: string[] = [];
            while ((match = rest.match(/^\s*([^\s,;]+)[\s,;]+/)) && emailPattern.test(match[1])) {
              added.push(match[1].toLowerCase());
              rest = rest.slice(match[0].length);
            }
            added.forEach((address) => addRecipient(address));
            setQuery(added.length ? rest.trimStart() : value);
          }}
          onKeyPress={onToKey}
          placeholder={recipients.length ? "" : "Name, @handle or email"}
          placeholderTextColor={colors.textTertiary}
          style={styles.toInput}
        />
      </Pressable>
      {suggestions ? (
        <ScrollView keyboardShouldPersistTaps="handled" style={styles.suggestions}>
          {typedAddress ? (
            <Pressable accessibilityRole="button" onPress={() => addRecipient(typedAddress)} style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.personRow, (hovered || pressed) && styles.rowHover]}>
              <View style={[styles.avatar, styles.suggestionIcon]}>
                <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
              </View>
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowTitle}>{typedAddress}</Text>
                <Text style={styles.preview}>{emailFrom ? `Email from ${emailFrom}` : "Email"}</Text>
              </View>
            </Pressable>
          ) : null}
          {contacts.map((contact) => (
            <Pressable key={contact.address} accessibilityRole="button" accessibilityLabel={`Add ${contact.name}, ${contact.address}`} onPress={() => addRecipient(contact.address, contact.name)} style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.personRow, (hovered || pressed) && styles.rowHover]}>
              <Avatar initials={contact.initials} imageUrls={contact.avatarUrls} />
              <View style={styles.rowCopy}>
                <Text numberOfLines={1} style={styles.rowTitle}>{contact.name}</Text>
                <Text numberOfLines={1} style={styles.preview}>{contact.address}</Text>
              </View>
            </Pressable>
          ))}
          {!writing
            ? results.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${person.name}, ${person.identities[0]?.value ?? ""}`}
                  onPress={() => {
                    setBusy(true);
                    onStart(person.id)
                      .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not start conversation."))
                      .finally(() => setBusy(false));
                  }}
                  style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.personRow, (hovered || pressed) && styles.rowHover]}
                >
                  <Avatar initials={person.initials} imageUrls={person.avatarUrls} />
                  <View style={styles.rowCopy}>
                    <Text numberOfLines={1} style={styles.rowTitle}><SavedName handle={person.identities[0]?.value ?? ""} fallback={person.name} /></Text>
                    <Text numberOfLines={1} style={styles.preview}>{person.identities[0]?.value} · Open Media</Text>
                  </View>
                </Pressable>
              ))
            : null}
          {busy ? <Loader style={{ margin: 18 }} color={colors.textTertiary} /> : null}
        </ScrollView>
      ) : (
        <View style={styles.newMessageSpace}>
          {error ? (
            <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text>
          ) : typed.length >= 2 && !typed.includes("@") && !busy ? (
            <Text style={styles.statusText}>No one found. Type an email address to send an email.</Text>
          ) : !writing ? (
            <Text style={styles.statusText}>
              Message someone on Open Media by name or @handle, or type an email address.{emailFrom ? "" : " Sending email needs a mailbox with outgoing mail in Settings → Connections."}
            </Text>
          ) : recipients.length > 1 ? (
            <Text style={styles.statusText}>Everyone gets the same email and sees who else is on it, like a group.</Text>
          ) : null}
        </View>
      )}
      {writing ? (
        <View style={styles.composerWrap}>
          <View style={styles.composer}>
            <TextInput
              ref={bodyInput}
              accessibilityLabel="Message"
              multiline
              maxLength={50_000}
              value={body}
              onChangeText={setBody}
              onKeyPress={onBodyKey}
              onContentSizeChange={(event) => Platform.OS !== "web" && fitComposer(event.nativeEvent.contentSize.height)}
              placeholder={emailFrom ? `Email from ${emailFrom}` : "Message"}
              placeholderTextColor={colors.textTertiary}
              style={[styles.composerInput, { height: inputHeight }]}
            />
            {sending ? (
              <View style={styles.send}><Loader size="small" color={colors.surface} /></View>
            ) : (
              <SendButton ready={Boolean(body.trim()) && Boolean(onSendEmail) && Boolean(emailFrom)} reduceMotion={reduceMotion} onPress={send} />
            )}
          </View>
        </View>
      ) : null}
    </View>
  );
}

/** One face for a chat with one person; two overlapping faces for a group, like iMessage. */
function ConversationAvatar({ people, size }: { people: Person[]; size: number }) {
  const { colors } = useOpenMediaTheme();
  if (people[0]?.id === aiPersonId) return <AiAvatar size={size} />;
  if (people.length < 2) return <Avatar initials={people[0]?.initials ?? "OM"} imageUrls={people[0]?.avatarUrls} size={size} />;
  const small = Math.round(size * 0.66);
  return (
    <View accessibilityLabel={`${people.length} people`} style={{ width: size, height: size }}>
      <View style={{ position: "absolute", top: 0, left: 0 }}>
        <Avatar initials={people[0].initials} imageUrls={people[0].avatarUrls} size={small} />
      </View>
      <View style={{ position: "absolute", right: 0, bottom: 0, borderRadius: small / 2 + 2, borderWidth: 2, borderColor: colors.surface }}>
        <Avatar initials={people[1].initials} imageUrls={people[1].avatarUrls} size={small - 2} />
      </View>
    </View>
  );
}

/** Open Media AI's picture: the AI mark from AI search, in the text colour's circle. */
function AiAvatar({ size }: { size: number }) {
  const { colors } = useOpenMediaTheme();
  return (
    <View accessibilityRole="image" accessibilityLabel="Open Media AI" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.text, alignItems: "center", justifyContent: "center" }}>
      <AiMark size={Math.round(size * 0.5)} color={colors.surface} />
    </View>
  );
}

/** Round picture: tries each image in order (BIMI logo, company icon), then shows initials. */
function Avatar({ initials, imageUrls = [], size = 40 }: { initials: string; imageUrls?: string[]; size?: number }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Native image views cannot draw SVG (BIMI logos); the web can.
  const candidates = useMemo(
    () => imageUrls.filter((url) => Platform.OS === "web" || !/\.svg(\?|$)/i.test(url)),
    [imageUrls],
  );
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [candidates]);
  const dimension = { width: size, height: size, borderRadius: size / 2 };
  const url = candidates[index];
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [url]);
  // Initials sit underneath, so a picture that is slow or missing never leaves a blank circle.
  return (
    <View style={[styles.avatar, dimension, loaded && styles.avatarFrame]}>
      {!loaded ? <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.32) }]}>{initials}</Text> : null}
      {url ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: url }}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((value) => value + 1)}
          resizeMode="cover"
          style={[dimension, styles.avatarPicture, !loaded && styles.avatarPictureLoading]}
        />
      ) : null}
    </View>
  );
}

/** The blue tick for senders that passed DMARC and publish a BIMI mark certificate. */
function VerifiedBadge({ domain }: { domain: string }) {
  return (
    <Ionicons
      accessibilityRole="image"
      accessibilityLabel={`Verified sender: ${domain}`}
      name="checkmark-circle"
      size={15}
      color={verifiedBlue}
    />
  );
}

/** "Verified sender · coursera.org · via you@…", without repeating an address that is already the title. */
/** An Open Media account under the name the viewer saved for them, if any. */
function SavedName({ handle, fallback }: { handle: string; fallback: string }) {
  return <>{useSavedName({ kind: "open_media", handle: handle.replace(/^@/, "") }) ?? fallback}</>;
}

/** Lower case without accents, so "lopez" finds "López". */
function folded(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Where a channel of a merged conversation goes: an email address, or the network's name. */
function channelSource(channel: Conversation) {
  return channel.messages[channel.messages.length - 1]?.source ?? channel.sourceSummary[0];
}

function channelLabel(channel: Conversation, sentence = false): string {
  const label = channel.email ? channel.email.address : sourceLabel(bridgedSourceOf(channel) ?? channel.sourceSummary[0]);
  return sentence ? (channel.email ? `by email to ${label}` : `on ${label}`) : label;
}

function channelsMeta(channels: Conversation[]): string {
  const names = [...new Set(channels.map((channel) => (channel.email ? "Email" : sourceLabel(bridgedSourceOf(channel) ?? channel.sourceSummary[0]))))];
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0] ?? "";
}

function emailMeta(conversation: Conversation, person?: Person): string {
  const email = conversation.email!;
  const who = conversation.participants.length > 1
    ? `Group email · ${conversation.participants.length + 1} people`
    : person?.verifiedDomain
    ? `Verified sender · ${person.verifiedDomain}`
    : email.address.toLowerCase() === conversationTitle(conversation).toLowerCase() ? "Email" : email.address;
  return `${who} · via ${email.accountEmail}${email.canSend ? "" : " (receive only)"}`;
}

/** A message that is a GIF, a sticker or a few emoji alone, drawn without a bubble (ADR 0029). */
type MessageArtKind = { media: ReturnType<typeof parseMessageMedia>; jumbo: number; text: string };
const artCache = new Map<string, MessageArtKind | null>();
function artOfBody(body: string): MessageArtKind | undefined {
  let art = artCache.get(body);
  if (art === undefined) {
    const media = parseMessageMedia(body);
    const jumbo = media ? 0 : jumboEmojiCount(body);
    art = media || jumbo ? { media, jumbo, text: body } : null;
    if (artCache.size > 2000) artCache.clear();
    artCache.set(body, art);
  }
  return art ?? undefined;
}
function artOf(message: Message): MessageArtKind | undefined {
  // Email keeps its own rendering, and Open Media AI writes Markdown.
  return message.channel === "email" || message.ai ? undefined : artOfBody(message.body);
}
function MessageArt({ art, outbound }: { art: MessageArtKind; outbound: boolean }) {
  return art.media ? <MessageMediaView media={art.media} outbound={outbound} /> : <JumboEmoji text={art.text} count={art.jumbo} />;
}

/** A GIF or sticker reads as “GIF” or “Sticker” in the list, after a group sender’s name. */
function listPreview(preview: string): string {
  const match = preview.match(/^([^:\n]{1,80}: )?(https:\/\/\S+)$/);
  const label = match ? mediaPreview(match[2]) : undefined;
  return label ? `${match![1] ?? ""}${label}` : preview;
}

/** One line of a message for quotes and the reply banner. */
function quoteText(message: Message): string {
  const text = message.channel === "email" ? formatEmailBody(message.body).plain : message.body;
  const line = text.split("\n").map((part) => part.trim()).find(Boolean);
  if (line) return (message.channel !== "email" && mediaPreview(line)) || line;
  if (message.attachments?.length) return message.attachments.every((item) => item.contentType.startsWith("image/")) ? "Photo" : "Attachment";
  return message.emailContext?.subject ?? "Message";
}

/**
 * A message bubble you can reply to, like iMessage: hover on the web shows a
 * reply button beside it; long-press anywhere starts a reply.
 */
function ReplyableBubble({ outbound, enabled, onReply, style, children }: React.PropsWithChildren<{ outbound: boolean; enabled: boolean; onReply: () => void; style: object }>) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [hovered, setHovered] = useState(false);
  if (!enabled) return <View style={style}>{children}</View>;
  return (
    <View style={[styles.replyRow, outbound && styles.replyRowOutbound]}>
      <Pressable
        accessibilityActions={[{ name: "reply", label: "Reply" }]}
        onAccessibilityAction={(event) => event.nativeEvent.actionName === "reply" && onReply()}
        onLongPress={onReply}
        delayLongPress={350}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={[style, styles.replyBubble]}
      >
        {children}
      </Pressable>
      {Platform.OS === "web" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reply"
          onPress={onReply}
          onHoverIn={() => setHovered(true)}
          onHoverOut={() => setHovered(false)}
          style={[styles.replyButton, !hovered && styles.replyButtonHidden]}
        >
          <Ionicons name="arrow-undo-outline" size={16} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Inline images under this size are usually footer icons, not content. */
const minInlineImageBytes = 8 * 1024;

/** Photos as rounded bubbles, files as chips, remote images on request. */
function MessageMedia({ message }: { message: Message }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [showRemote, setShowRemote] = useState(false);
  const attachments = (message.attachments ?? []).filter(
    (item) => !(item.inline && item.contentType.startsWith("image/") && item.size < minInlineImageBytes),
  );
  const images = attachments.filter((item) => item.contentType.startsWith("image/") && item.storagePath);
  const files = attachments.filter((item) => !images.includes(item));
  const remote = message.remoteImages ?? [];
  const outbound = message.direction === "outbound";
  if (!images.length && !files.length && !remote.length) return null;
  return (
    <View style={[styles.media, outbound && styles.mediaOutbound]}>
      {images.map((item) => (
        <PhotoBubble key={item.storagePath} attachment={item} />
      ))}
      {files.map((item, index) => (
        <FileChip key={`${item.name}-${index}`} attachment={item} />
      ))}
      {remote.length ? (
        showRemote ? (
          remote.map((url) => <PhotoBubble key={url} url={url} />)
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Images load from the sender's servers, which can tell them you opened this email."
            onPress={() => setShowRemote(true)}
            style={styles.showImages}
          >
            <Ionicons name="image-outline" size={16} color={colors.textSecondary} />
            <Text style={styles.showImagesText}>
              Show {remote.length} {remote.length === 1 ? "image" : "images"}
            </Text>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

function PhotoBubble({ attachment, url: directURL }: { attachment?: MessageAttachment; url?: string }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [url, setURL] = useState(directURL);
  const [ratio, setRatio] = useState(4 / 3);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (directURL || !attachment?.storagePath) return;
    let active = true;
    attachmentURL(attachment.storagePath).then((value) => active && setURL(value), () => active && setFailed(true));
    return () => { active = false; };
  }, [attachment?.storagePath, directURL]);
  useEffect(() => {
    if (!url) return;
    Image.getSize(url, (width, height) => width && height && setRatio(Math.min(Math.max(width / height, 0.5), 2.5)), () => undefined);
  }, [url]);
  if (failed) return null;
  return (
    <Pressable
      accessibilityRole="imagebutton"
      accessibilityLabel={attachment ? `Photo: ${attachment.name}` : "Image from this email"}
      disabled={!url}
      onPress={() => url && Linking.openURL(url)}
      style={[styles.photo, { aspectRatio: ratio }]}
    >
      {url ? (
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: url }}
          resizeMode="cover"
          onError={() => setFailed(true)}
          style={styles.photoImage}
        />
      ) : (
        <Loader color={colors.textTertiary} />
      )}
    </Pressable>
  );
}

function FileChip({ attachment }: { attachment: MessageAttachment }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState(false);
  const available = Boolean(attachment.storagePath);
  const open = async () => {
    if (!attachment.storagePath) return;
    setBusy(true);
    try { await Linking.openURL(await attachmentURL(attachment.storagePath)); }
    finally { setBusy(false); }
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${attachment.name}, ${formatBytes(attachment.size)}`}
      disabled={!available || busy}
      onPress={open}
      style={styles.fileChip}
    >
      <View style={styles.fileIcon}>
        {busy ? <Loader size="small" color={colors.text} /> : <Ionicons name={fileIcon(attachment.contentType)} size={18} color={colors.text} />}
      </View>
      <View style={styles.fileCopy}>
        <Text numberOfLines={1} style={styles.fileName}>{attachment.name}</Text>
        <Text numberOfLines={1} style={styles.fileMeta}>
          {available ? `${fileKind(attachment)} · ${formatBytes(attachment.size)}` : `${formatBytes(attachment.size)} · Open in your mail app`}
        </Text>
      </View>
      {available ? <Ionicons name="arrow-down-circle-outline" size={20} color={colors.textTertiary} /> : null}
    </Pressable>
  );
}

function fileIcon(contentType: string): keyof typeof Ionicons.glyphMap {
  if (contentType.startsWith("image/")) return "image-outline";
  if (contentType.startsWith("video/")) return "film-outline";
  if (contentType.startsWith("audio/")) return "musical-notes-outline";
  if (contentType === "application/pdf") return "document-text-outline";
  if (/zip|compressed|tar|gzip/.test(contentType)) return "archive-outline";
  if (/calendar/.test(contentType)) return "calendar-outline";
  if (/sheet|excel|csv/.test(contentType)) return "grid-outline";
  if (/presentation|powerpoint|keynote/.test(contentType)) return "easel-outline";
  return "document-outline";
}

function fileKind(attachment: MessageAttachment): string {
  const extension = attachment.name.includes(".") ? attachment.name.split(".").pop()!.toUpperCase().slice(0, 5) : "";
  return extension || attachment.contentType.split("/")[1]?.toUpperCase().slice(0, 8) || "File";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** A chat message; one from someone else is shown in the reader's language, never stored (ADR 0022). */
function MessageText({ message, style }: { message: Message; style: StyleProp<TextStyle> }) {
  if (message.ai) return <AiText message={message} style={style} />;
  return <PersonText message={message} style={style} />;
}

/** Open Media AI writes Markdown; what you sent stays as you wrote it. */
function AiText({ message, style }: { message: Message; style: StyleProp<TextStyle> }) {
  const blocks = useMemo(() => (message.direction === "inbound" ? parseMarkdown(message.body) : null), [message.body, message.direction]);
  return blocks ? <MarkdownBody blocks={blocks} source="open_media" style={style} collapsed={false} /> : <Text style={style}>{message.body}</Text>;
}

function PersonText({ message, style }: { message: Message; style: StyleProp<TextStyle> }) {
  const translation = useTranslation(message.id, message.direction === "outbound" ? [] : [message.body], "private");
  return (
    <>
      <Text style={style}>{translation.texts[0] ?? message.body}</Text>
      <TranslationNote note={translation.note} />
    </>
  );
}

/** Email shown like a message: links as words, quoted history hidden, long mail collapsed. */
function EmailBody({ message }: { message: Message }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const formatted = useMemo(() => formatEmailBody(message.body), [message.body]);
  const long = formatted.plain.length > 600 || formatted.plain.split("\n").length > 10;
  const [expanded, setExpanded] = useState(false);
  const outbound = message.direction === "outbound";
  // Email is private: translated without being stored (ADR 0022). A translation is plain text.
  const translation = useTranslation(message.id, outbound ? [] : [formatted.plain], "private");
  const translated = translation.note && translation.texts[0] !== formatted.plain ? translation.texts[0] : undefined;
  return (
    <View>
      <Text
        numberOfLines={long && !expanded ? 10 : undefined}
        style={[styles.message, outbound && styles.outboundMessage]}
      >
        {translated ?? formatted.segments.map((segment, index) =>
          segment.url ? (
            <Text
              key={index}
              accessibilityRole="link"
              onPress={() => Linking.openURL(segment.url!)}
              style={[styles.emailLink, outbound && styles.outboundMessage]}
            >
              {segment.text}
            </Text>
          ) : (
            <Text key={index}>{segment.text}</Text>
          ),
        )}
      </Text>
      <TranslationNote note={translation.note} />
      {long ? (
        <Pressable accessibilityRole="button" onPress={() => setExpanded((value) => !value)}>
          <Text style={[styles.showMore, outbound && styles.outboundMessage]}>
            {expanded ? "Show less" : "Show more"}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
function useKeyboardInset(target: React.RefObject<View | null>) {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (event) => {
      target.current?.measureInWindow((_x, y, _width, height) => {
        setInset(Math.max(0, y + height - event.endCoordinates.screenY));
      });
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => setInset(0));
    return () => { show.remove(); hide.remove(); };
  }, [target]);
  return inset;
}

function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
}

/**
 * The receipt under a message you sent (ADR 0026), in the familiar symbols: a clock while sending,
 * one tick when sent, two when delivered, two in full colour when read. The latest message also says
 * it in words, "Read 9:41 PM", so the state never depends on telling greys apart.
 */
function ReceiptLine({ message, withLabel }: { message: Message; withLabel: boolean }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const receipt = receiptOf(message);
  if (!receipt) return null;
  const icon = receipt === "sending" ? "time-outline" : receipt === "failed" ? "alert-circle" : receipt === "sent" ? "checkmark" : "checkmark-done";
  const tint = receipt === "read" ? colors.text : receipt === "failed" ? colors.danger : colors.textTertiary;
  const label = receiptLabel(receipt, message, (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
  return (
    <View accessible accessibilityLabel={label} style={styles.receiptLine}>
      {withLabel ? <Text style={[styles.receiptText, receipt === "read" && styles.receiptTextRead]}>{label}</Text> : null}
      <Ionicons name={icon} size={receipt === "sent" ? 13 : 15} color={tint} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    layout: { flex: 1, flexDirection: "row", backgroundColor: colors.surface },
    list: {
      width: "100%",
      maxWidth: 390,
      borderRightWidth: 1,
      borderRightColor: colors.border,
    },
    // Phones show one pane at a time, so the list takes the full width.
    listCompact: { maxWidth: "100%", borderRightWidth: 0 },
    heading: {
      paddingHorizontal: 18,
      paddingTop: 24,
      paddingBottom: 13,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    headingCopy: { flex: 1 },
    title: {
      color: colors.text,
      fontSize: 28,
      fontWeight: "800",
      letterSpacing: -0.8,
    },
    subtitle: { marginTop: 5, color: colors.textSecondary, fontSize: 12 },
    newButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.text,
    },
    headingActions: { flexDirection: "row", alignItems: "center", gap: 8 },
    pullEmpty: { flex: 1 },
    pullEmptyContent: { flexGrow: 1 },
    // A quiet outlined twin of New message; it fills in, like New message, while it's on.
    unreadButton: {
      width: 42,
      height: 42,
      borderRadius: 21,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    unreadButtonHover: { backgroundColor: colors.chrome },
    unreadButtonActive: { backgroundColor: colors.text, borderColor: colors.text },
    matrixBadge: {
      minHeight: 30,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: 15,
      backgroundColor: colors.chrome,
    },
    matrixBadgeText: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: "700",
      letterSpacing: 0.8,
    },
    filterBar: { flexGrow: 0, flexShrink: 0 },
    filters: { paddingHorizontal: 18, paddingVertical: 10, gap: 7, alignItems: "center" },
    chip: {
      height: 34,
      justifyContent: "center",
      paddingHorizontal: 13,
      borderRadius: 17,
      backgroundColor: colors.chrome,
    },
    chipActive: { backgroundColor: colors.text },
    chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
    chipTextActive: { color: colors.surface },
    center: {
      flex: 1,
      minHeight: 220,
      alignItems: "center",
      justifyContent: "center",
      padding: 26,
    },
    statusText: {
      marginTop: 9,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
    },
    error: {
      margin: 18,
      color: colors.danger,
      fontSize: 12,
      lineHeight: 18,
      textAlign: "center",
    },
    emptyTitle: {
      marginTop: 12,
      color: colors.text,
      fontSize: 15,
      fontWeight: "800",
    },
    emptyAction: {
      minHeight: 42,
      marginTop: 17,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 21,
      backgroundColor: colors.text,
    },
    emptyActionText: { color: colors.surface, fontSize: 12, fontWeight: "800" },
    row: {
      minHeight: 76,
      marginHorizontal: 8,
      paddingHorizontal: 10,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 14,
    },
    // Inside a swipeable row, the swipe frame holds the margin so the action shows behind the row only.
    rowInSwipe: { marginHorizontal: 0 },
    rowHover: { backgroundColor: colors.chrome },
    rowActive: { backgroundColor: colors.bubble },
    rowTime: { marginLeft: "auto", paddingLeft: 6, flexShrink: 0, color: colors.textTertiary, fontSize: 12, fontVariant: ["tabular-nums"] },
    avatarFrame: { overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    avatarPicture: { position: "absolute", top: 0, left: 0 },
    avatarPictureLoading: { opacity: 0 },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bubble,
    },
    avatarText: { color: colors.textSecondary, fontSize: 12, fontWeight: "700", letterSpacing: 0.3 },
    avatarImage: { backgroundColor: colors.chrome },
    emailLink: { color: colors.text, textDecorationLine: "underline", fontWeight: "600" },
    showMore: { marginTop: 8, color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
    rowTitle: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
    unread: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    preview: { marginTop: 2, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    threadPane: { flex: 1, minWidth: 0 },
    thread: { flex: 1, backgroundColor: colors.surface },
    threadHeadingLink: { flex: 1, minWidth: 0 },
    threadHeader: {
      minHeight: 96,
      paddingHorizontal: 12,
      paddingVertical: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    threadHeading: { flex: 1, minWidth: 0, alignItems: "center", gap: 4 },
    threadNameLine: { justifyContent: "center", maxWidth: "100%" },
    back: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    threadTitle: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
    threadMeta: { maxWidth: "100%", color: colors.textTertiary, fontSize: 12, textAlign: "center" },
    threadContent: {
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
      paddingHorizontal: 16,
      paddingVertical: 18,
      flexGrow: 1,
    },
    timeSeparator: {
      marginTop: 18,
      marginBottom: 6,
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: "600",
      textAlign: "center",
    },
    threadEmpty: {
      flex: 1,
      minHeight: 240,
      alignItems: "center",
      justifyContent: "center",
    },
    messageWrap: { maxWidth: "76%", alignSelf: "flex-start", marginTop: 2 },
    outboundWrap: { alignSelf: "flex-end" },
    groupStart: { marginTop: 10 },
    groupSender: { marginBottom: 3, marginLeft: 12, color: colors.textTertiary, fontSize: 12, fontWeight: "600" },
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 20,
      backgroundColor: colors.bubble,
    },
    outboundBubble: { backgroundColor: colors.text },
    // GIFs, stickers and emoji on their own: no bubble behind them.
    bareBubble: { paddingVertical: 2 },
    inboundTail: { borderBottomLeftRadius: 6 },
    outboundTail: { borderBottomRightRadius: 6 },
    bubbleSubject: { marginBottom: 3, color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: "700" },
    bubbleSource: { marginTop: 4, marginHorizontal: 6, alignSelf: "flex-start" },
    aiByline: { marginTop: 4, marginHorizontal: 6, flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", maxWidth: "80%" },
    aiBylineText: { fontSize: 11, fontWeight: "600", color: colors.textTertiary },
    aiThinkingBubble: { paddingVertical: 10, paddingHorizontal: 14 },
    previewLine: { flexDirection: "row", alignItems: "flex-start", gap: 5 },
    previewShrink: { flex: 1 },
    channelBar: { paddingHorizontal: 18, paddingTop: 6, minHeight: 30, justifyContent: "center" },
    channelCurrent: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 5, minHeight: 26, paddingRight: 6, borderRadius: 13 },
    channelCurrentText: { flexShrink: 1, color: colors.textTertiary, fontSize: 12, fontWeight: "500" },
    channelChoices: { gap: 6, paddingRight: 8 },
    channelChoice: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 28, paddingHorizontal: 11, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    channelChoiceActive: { backgroundColor: colors.text, borderColor: colors.text },
    channelChoiceOff: { opacity: 0.45 },
    channelChoiceText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
    channelChoiceTextActive: { color: colors.surface },
    replyRow: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6 },
    replyBubble: { flexShrink: 1, minWidth: 0 },
    replyRowOutbound: { flexDirection: "row-reverse" },
    replyButton: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.chrome },
    replyButtonHidden: { opacity: 0 },
    quote: { marginBottom: 6, paddingLeft: 9, borderLeftWidth: 3, borderLeftColor: colors.textTertiary },
    quoteOutbound: { borderLeftColor: colors.surface, opacity: 0.85 },
    quoteName: { color: colors.textSecondary, fontSize: 12, fontWeight: "700" },
    quoteNameOutbound: { color: colors.surface },
    quoteText: { marginTop: 1, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    quoteTextOutbound: { color: colors.surface },
    replyBanner: { marginBottom: 8, paddingVertical: 8, paddingLeft: 10, paddingRight: 4, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, backgroundColor: colors.chrome },
    replyBar: { width: 3, alignSelf: "stretch", borderRadius: 2, backgroundColor: colors.text },
    replyBannerCopy: { flex: 1, minWidth: 0 },
    replyBannerTitle: { color: colors.text, fontSize: 12, fontWeight: "700" },
    replyBannerText: { marginTop: 1, color: colors.textSecondary, fontSize: 13 },
    replyCancel: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
    media: { marginTop: 4, gap: 4, alignItems: "flex-start", width: 280, maxWidth: "100%" },
    mediaOutbound: { alignItems: "flex-end", alignSelf: "flex-end" },
    photo: {
      width: "100%",
      maxHeight: 360,
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 18,
      backgroundColor: colors.bubble,
      borderWidth: 1,
      borderColor: colors.border,
    },
    photoImage: { width: "100%", height: "100%" },
    fileChip: {
      width: "100%",
      minHeight: 56,
      paddingHorizontal: 10,
      paddingVertical: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    fileIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.chrome },
    fileCopy: { flex: 1, minWidth: 0 },
    fileName: { color: colors.text, fontSize: 14, fontWeight: "600" },
    fileMeta: { marginTop: 2, color: colors.textTertiary, fontSize: 12 },
    showImages: {
      minHeight: 36,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    showImagesText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
    message: { color: colors.text, fontSize: 15, lineHeight: 21 },
    outboundMessage: { color: colors.surface },
    composerWrap: {
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    composer: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      paddingVertical: 4,
      paddingRight: 4,
      paddingLeft: 16,
      borderRadius: 23,
      backgroundColor: colors.chrome,
      borderWidth: 1,
      borderColor: colors.border,
      // @ts-expect-error web-only style
      transitionProperty: "border-color, background-color",
      transitionDuration: "160ms",
    },
    composerFocused: { borderColor: colors.textTertiary, backgroundColor: colors.surface },
    composerWithTools: { paddingLeft: 4 },
    mediaToggle: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    mediaToggleOn: { backgroundColor: colors.chrome },
    mediaTogglePressed: { transform: [{ scale: 0.9 }] },
    composerInput: {
      flex: 1,
      marginVertical: 8,
      paddingVertical: 0,
      color: colors.text,
      fontSize: 15,
      lineHeight: composerLineHeight,
      outlineStyle: "none",
      resize: "none",
    } as object,
    send: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.text,
    },
    sendingBubble: { opacity: 0.72 },
    failedBubble: { opacity: 0.45 },
    deliveryStatus: { marginTop: 3, marginRight: 6, alignSelf: "flex-end", color: colors.textTertiary, fontSize: 11 },
    receiptLine: { minHeight: 18, marginTop: 3, marginRight: 6, flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 4 },
    receiptText: { color: colors.textTertiary, fontSize: 11, fontWeight: "500" },
    receiptTextRead: { color: colors.textSecondary },
    deliveryLine: { minHeight: 24, marginTop: 2, flexDirection: "row", alignItems: "center", alignSelf: "flex-end", gap: 4 },
    deliveryFailed: { color: colors.danger, fontSize: 12, fontWeight: "600" },
    disabledComposer: {
      minHeight: 58,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    disabledText: { flex: 1, color: colors.textTertiary, fontSize: 13, lineHeight: 18 },
    backdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 18,
      backgroundColor: "rgba(0,0,0,0.48)",
    },
    modal: {
      width: "100%",
      maxWidth: 500,
      maxHeight: "82%",
      paddingVertical: 18,
      borderRadius: 22,
      backgroundColor: colors.surface,
    },
    newPanel: { flex: 1, paddingTop: 4 },
    toField: {
      minHeight: 48,
      marginHorizontal: 18,
      paddingVertical: 6,
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 6,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    toLabel: { marginRight: 2, color: colors.textSecondary, fontSize: 15 },
    toInput: { flexGrow: 1, minWidth: 140, minHeight: 34, paddingVertical: 0, color: colors.text, fontSize: 15, outlineStyle: "none" } as object,
    recipientChip: {
      maxWidth: "100%",
      height: 30,
      paddingLeft: 11,
      paddingRight: 7,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: 15,
      backgroundColor: colors.bubble,
    },
    recipientName: { flexShrink: 1, color: colors.text, fontSize: 14, fontWeight: "600" },
    suggestions: { flex: 1, paddingTop: 6 },
    suggestionIcon: { width: 40, height: 40, borderRadius: 20 },
    newMessageSpace: { flex: 1, paddingHorizontal: 12, paddingTop: 8 },
    modalHeader: {
      paddingHorizontal: 18,
      marginBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: { color: colors.text, fontSize: 19, fontWeight: "800" },
    close: {
      width: 42,
      height: 42,
      alignItems: "center",
      justifyContent: "center",
    },
    results: { minHeight: 140, maxHeight: 350, marginTop: 12 },
    personRow: {
      minHeight: 66,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalFootnote: {
      marginTop: 12,
      paddingHorizontal: 18,
      color: colors.textTertiary,
      fontSize: 12,
      lineHeight: 17,
    },
    safetyCopy: {
      paddingHorizontal: 18,
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 18,
    },
    safetyStatus: {
      margin: 18,
      color: colors.text,
      fontSize: 12,
      fontWeight: "700",
    },
    safetyAction: {
      minHeight: 46,
      marginHorizontal: 18,
      marginTop: 18,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 23,
      backgroundColor: colors.text,
    },
    safetyActionText: {
      color: colors.surface,
      fontSize: 13,
      fontWeight: "800",
    },
    reportAction: {
      minHeight: 46,
      marginHorizontal: 18,
      marginTop: 10,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 23,
      borderWidth: 1,
      borderColor: colors.danger,
    },
    reportActionText: { color: colors.danger, fontSize: 13, fontWeight: "800" },
  });
}

/** The person a one-to-one thread is with, for opening their profile; groups open the first member. */
function threadTarget(conversation: Conversation, person?: Person): PersonTarget {
  // Open Media AI has no profile to open.
  if (isAiConversation(conversation)) return { ref: { kind: "network", network: "open-media-ai", handle: "" } as unknown as PersonTarget["ref"], name: conversationTitle(conversation) };
  const encounter = encounterForConversation(conversation);
  return { ref: encounter?.ref ?? { kind: 'open_media', handle: person?.identities.find((identity) => identity.source === 'open_media')?.value.replace(/^@/, '') ?? '' }, name: conversationTitle(conversation), avatarUrl: person?.avatarUrls?.[0] };
}
