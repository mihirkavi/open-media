import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { Conversation, PeopleFilter, Person } from "../domain/models";
import { conversationTitle, filterConversations } from "../domain/selectors";
import { ThemeColors } from "../theme";
import { useOpenMediaTheme } from "../themeContext";
import { SourceMarker } from "./SourceMarker";
import type { MessageMode } from "./OpenMediaApp";

interface Props {
  conversations: Conversation[];
  loading: boolean;
  error: string;
  messageMode: MessageMode;
  blockedUserIds: string[];
  onRetry: () => Promise<void>;
  onSend: (conversationId: string, body: string) => Promise<void>;
  onSearchProfiles: (query: string) => Promise<Person[]>;
  onStartConversation: (personId: string) => Promise<string>;
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
  onSetBlocked,
  onReport,
}: Props) {
  const { width } = useWindowDimensions();
  const compact = width < 760;
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>("all");
  const [newMessageOpen, setNewMessageOpen] = useState(false);
  const filtered = useMemo(
    () =>
      filterConversations(conversations, {
        peopleFilter,
        query,
        unreadOnly: false,
      }),
    [conversations, peopleFilter, query],
  );
  const selected =
    conversations.find((conversation) => conversation.id === selectedId) ??
    (!compact ? filtered[0] : undefined);
  if (compact && selected)
    return (
      <MessageThread
        conversation={selected}
        blocked={selected.participants.some((person) =>
          blockedUserIds.includes(person.id),
        )}
        onBack={() => setSelectedId(undefined)}
        onSend={onSend}
        onSetBlocked={onSetBlocked}
        onReport={onReport}
      />
    );
  return (
    <View style={styles.layout}>
      <View style={styles.list}>
        <View style={styles.heading}>
          <View style={styles.headingCopy}>
            <Text style={styles.title}>Messages</Text>
            <Text style={styles.subtitle}>
              {messageMode === "matrix"
                ? "Local Matrix sandbox room."
                : "People first. Open Media messages are live."}
            </Text>
          </View>
          {messageMode === "open_media" ? (
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
          ) : (
            <View style={styles.matrixBadge}>
              <Ionicons name="git-network-outline" size={14} color="#0D9488" />
              <Text style={styles.matrixBadgeText}>MATRIX</Text>
            </View>
          )}
        </View>
        <View style={styles.search}>
          <Ionicons name="search" size={17} color={colors.textSecondary} />
          <TextInput
            accessibilityLabel="Search messages"
            value={query}
            onChangeText={setQuery}
            placeholder="Search people and messages"
            placeholderTextColor={colors.textTertiary}
            style={styles.searchInput}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filters}
        >
          {(["all", "direct", "groups", "favorites"] as PeopleFilter[]).map(
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
            <ActivityIndicator color={colors.text} />
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
          <ScrollView>
            {filtered.map((conversation) => (
              <Pressable
                key={conversation.id}
                accessibilityRole="button"
                accessibilityLabel={`${conversationTitle(conversation)}. ${conversation.preview}`}
                onPress={() => setSelectedId(conversation.id)}
                style={[
                  styles.row,
                  selected?.id === conversation.id && styles.rowActive,
                ]}
              >
                <Avatar
                  initials={conversation.participants[0]?.initials ?? "OM"}
                />
                <View style={styles.rowCopy}>
                  <View style={styles.rowTitleLine}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {conversationTitle(conversation)}
                    </Text>
                    {conversation.unreadCount ? (
                      <View style={styles.unread} />
                    ) : null}
                  </View>
                  <Text numberOfLines={1} style={styles.preview}>
                    {conversation.preview}
                  </Text>
                  <View style={styles.sources}>
                    {conversation.sourceSummary.map((source) => (
                      <SourceMarker key={source} source={source} />
                    ))}
                  </View>
                </View>
              </Pressable>
            ))}
          </ScrollView>
        ) : (
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
        )}
      </View>
      {!compact ? (
        <View style={styles.threadPane}>
          {selected ? (
            <MessageThread
              conversation={selected}
              blocked={selected.participants.some((person) =>
                blockedUserIds.includes(person.id),
              )}
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
      <NewMessageModal
        visible={messageMode === "open_media" && newMessageOpen}
        onClose={() => setNewMessageOpen(false)}
        onSearch={onSearchProfiles}
        onStart={async (personId) => {
          const id = await onStartConversation(personId);
          setSelectedId(id);
          setNewMessageOpen(false);
        }}
      />
    </View>
  );
}

function MessageThread({
  conversation,
  blocked,
  onBack,
  onSend,
  onSetBlocked,
  onReport,
}: {
  conversation: Conversation;
  blocked: boolean;
  onBack?: () => void;
  onSend: (conversationId: string, body: string) => Promise<void>;
  onSetBlocked: (personId: string, blocked: boolean) => Promise<void>;
  onReport: (
    conversationId: string,
    personId: string,
    messageId?: string,
  ) => Promise<void>;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [safetyStatus, setSafetyStatus] = useState("");
  const canSend =
    !blocked &&
    (conversation.sourceSummary.includes("open_media") ||
      conversation.sourceSummary.includes("matrix"));
  const throughMatrix = conversation.sourceSummary.includes("matrix");
  const otherPerson = conversation.participants[0];
  const reportableMessage = [...conversation.messages]
    .reverse()
    .find(
      (message) =>
        message.direction === "inbound" &&
        message.senderPersonId === otherPerson?.id,
    );
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError("");
    try {
      await onSend(conversation.id, body);
      setBody("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Message could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={styles.thread}>
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
        <View style={styles.threadHeading}>
          <Text style={styles.threadTitle}>
            {conversationTitle(conversation)}
          </Text>
          <Text style={styles.threadMeta}>
            {blocked
              ? "Blocked · messaging paused"
              : throughMatrix
              ? "Matrix · local development sandbox"
              : canSend
                ? "Open Media · private to conversation members"
                : "Imported conversation · reply unavailable"}
          </Text>
        </View>
        {otherPerson &&
        !conversation.groupTitle &&
        conversation.sourceSummary.includes("open_media") ? (
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
      <ScrollView contentContainerStyle={styles.threadContent}>
        {conversation.messages.length ? (
          conversation.messages.map((message) => (
            <View
              key={message.id}
              style={[
                styles.messageWrap,
                message.direction === "outbound" && styles.outboundWrap,
              ]}
            >
              {message.emailContext ? (
                <Text style={styles.subject}>
                  {message.emailContext.subject}
                </Text>
              ) : null}
              <View
                style={[
                  styles.bubble,
                  message.direction === "outbound" && styles.outboundBubble,
                ]}
              >
                <Text
                  style={[
                    styles.message,
                    message.direction === "outbound" && styles.outboundMessage,
                  ]}
                >
                  {message.body}
                </Text>
                <View style={styles.messageMeta}>
                  <SourceMarker
                    source={message.source}
                    inverse={message.direction === "outbound"}
                  />
                  <Text
                    style={[
                      styles.time,
                      message.direction === "outbound" && styles.outboundTime,
                    ]}
                  >
                    {new Intl.DateTimeFormat("en", {
                      hour: "numeric",
                      minute: "2-digit",
                    }).format(new Date(message.sentAt))}
                  </Text>
                </View>
              </View>
            </View>
          ))
        ) : (
          <View style={styles.threadEmpty}>
            <Text style={styles.emptyTitle}>Say hello</Text>
            <Text style={styles.statusText}>
              Messages you send here are delivered through{" "}
              {throughMatrix ? "Matrix" : "Open Media"}.
            </Text>
          </View>
        )}
      </ScrollView>
      {canSend ? (
        <View style={styles.composerWrap}>
          {error ? (
            <Text
              accessibilityLiveRegion="assertive"
              style={styles.composerError}
            >
              {error}
            </Text>
          ) : null}
          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="Message"
              maxLength={8000}
              multiline
              value={body}
              onChangeText={setBody}
              placeholder={throughMatrix ? "Message through Matrix" : "Message"}
              placeholderTextColor={colors.textTertiary}
              style={styles.composerInput}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={busy || !body.trim()}
              onPress={submit}
              style={[
                styles.send,
                (busy || !body.trim()) && styles.sendDisabled,
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.surface} />
              ) : (
                <Ionicons name="arrow-up" size={19} color={colors.surface} />
              )}
            </Pressable>
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
                if (!otherPerson) return;
                setBusy(true);
                setSafetyStatus("");
                try {
                  await onSetBlocked(otherPerson.id, !blocked);
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
                if (!otherPerson) return;
                setBusy(true);
                setSafetyStatus("");
                try {
                  await onReport(
                    conversation.id,
                    otherPerson.id,
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

function NewMessageModal({
  visible,
  onClose,
  onSearch,
  onStart,
}: {
  visible: boolean;
  onClose: () => void;
  onSearch: (query: string) => Promise<Person[]>;
  onStart: (personId: string) => Promise<void>;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Person[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    if (!visible) {
      setQuery("");
      setResults([]);
      setError("");
      setBusy(false);
      return;
    }
    const timeout = setTimeout(() => {
      if (query.trim().length < 2) {
        setResults([]);
        setBusy(false);
        return;
      }
      setBusy(true);
      setError("");
      onSearch(query)
        .then((people) => {
          if (active) setResults(people);
        })
        .catch((reason) => {
          if (active)
            setError(
              reason instanceof Error ? reason.message : "Search failed.",
            );
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, visible, onSearch]);
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>New message</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={onClose}
              style={styles.close}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>
          <View style={styles.search}>
            <Ionicons name="search" size={17} color={colors.textSecondary} />
            <TextInput
              accessibilityLabel="Find people"
              autoCapitalize="none"
              autoFocus
              value={query}
              onChangeText={setQuery}
              placeholder="Name or @handle"
              placeholderTextColor={colors.textTertiary}
              style={styles.searchInput}
            />
          </View>
          {busy ? (
            <ActivityIndicator style={{ margin: 28 }} color={colors.text} />
          ) : error ? (
            <Text accessibilityLiveRegion="assertive" style={styles.error}>
              {error}
            </Text>
          ) : (
            <ScrollView style={styles.results}>
              {results.map((person) => (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${person.name}, ${person.identities[0]?.value ?? ""}`}
                  disabled={busy}
                  onPress={() => {
                    setBusy(true);
                    onStart(person.id)
                      .catch((reason) =>
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : "Could not start conversation.",
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                  style={styles.personRow}
                >
                  <Avatar initials={person.initials} />
                  <View>
                    <Text style={styles.rowTitle}>{person.name}</Text>
                    <Text style={styles.preview}>
                      {person.identities[0]?.value}
                    </Text>
                  </View>
                </Pressable>
              ))}
              {query.length >= 2 && !results.length ? (
                <Text style={styles.statusText}>
                  No Open Media profiles found.
                </Text>
              ) : null}
            </ScrollView>
          )}
          <Text style={styles.modalFootnote}>
            Only people who have finished Open Media onboarding appear here.
          </Text>
        </View>
      </View>
    </Modal>
  );
}

function Avatar({ initials }: { initials: string }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.avatar}>
      <Text style={styles.avatarText}>{initials}</Text>
    </View>
  );
}
function capitalize(value: string) {
  return value[0].toUpperCase() + value.slice(1);
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
    matrixBadge: {
      minHeight: 30,
      paddingHorizontal: 10,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      borderRadius: 15,
      backgroundColor: "#E8F7F4",
    },
    matrixBadgeText: {
      color: "#0D7068",
      fontSize: 8,
      fontWeight: "900",
      letterSpacing: 0.8,
    },
    search: {
      minHeight: 44,
      marginHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.chrome,
    },
    searchInput: {
      flex: 1,
      minHeight: 42,
      color: colors.text,
      fontSize: 13,
      outlineStyle: "none",
    } as object,
    filters: { paddingHorizontal: 18, paddingVertical: 10, gap: 7 },
    chip: {
      minHeight: 34,
      justifyContent: "center",
      paddingHorizontal: 13,
      borderRadius: 17,
      backgroundColor: colors.chrome,
    },
    chipActive: { backgroundColor: colors.text },
    chipText: { color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
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
      color: "#B42318",
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
      minHeight: 82,
      paddingHorizontal: 17,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    rowActive: { backgroundColor: colors.chrome },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.text,
    },
    avatarText: { color: colors.surface, fontSize: 10, fontWeight: "800" },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
    rowTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
    unread: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    preview: { marginTop: 4, color: colors.textSecondary, fontSize: 11 },
    sources: { marginTop: 5, flexDirection: "row", gap: 3 },
    threadPane: { flex: 1, minWidth: 0 },
    thread: { flex: 1, backgroundColor: colors.surfaceAlt },
    threadHeader: {
      minHeight: 70,
      paddingHorizontal: 18,
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    threadHeading: { flex: 1 },
    back: {
      width: 44,
      height: 44,
      alignItems: "center",
      justifyContent: "center",
    },
    threadTitle: { color: colors.text, fontSize: 15, fontWeight: "700" },
    threadMeta: { marginTop: 3, color: colors.textTertiary, fontSize: 10 },
    threadContent: {
      width: "100%",
      maxWidth: 700,
      alignSelf: "center",
      padding: 22,
      flexGrow: 1,
    },
    threadEmpty: {
      flex: 1,
      minHeight: 240,
      alignItems: "center",
      justifyContent: "center",
    },
    messageWrap: { maxWidth: "78%", alignSelf: "flex-start", marginBottom: 12 },
    outboundWrap: { alignSelf: "flex-end" },
    subject: {
      marginBottom: 5,
      color: colors.textTertiary,
      fontSize: 9,
      fontWeight: "600",
    },
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: 18,
      borderBottomLeftRadius: 5,
      backgroundColor: colors.chrome,
    },
    outboundBubble: {
      borderBottomLeftRadius: 18,
      borderBottomRightRadius: 5,
      backgroundColor: colors.text,
    },
    message: { color: colors.text, fontSize: 14, lineHeight: 20 },
    outboundMessage: { color: colors.surface },
    messageMeta: {
      marginTop: 6,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    time: { color: colors.textTertiary, fontSize: 8 },
    outboundTime: { color: colors.surface },
    composerWrap: {
      paddingHorizontal: 14,
      paddingTop: 8,
      paddingBottom: 10,
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    composer: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 8,
      padding: 5,
      paddingLeft: 14,
      borderRadius: 24,
      backgroundColor: colors.chrome,
      borderWidth: 1,
      borderColor: colors.border,
    },
    composerInput: {
      flex: 1,
      maxHeight: 120,
      minHeight: 36,
      paddingVertical: 8,
      color: colors.text,
      fontSize: 14,
      outlineStyle: "none",
    } as object,
    send: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.text,
    },
    sendDisabled: { opacity: 0.3 },
    composerError: { marginBottom: 6, color: "#B42318", fontSize: 10 },
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
    disabledText: { color: colors.textTertiary, fontSize: 10 },
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
      fontSize: 9,
      lineHeight: 14,
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
      borderColor: "#B42318",
    },
    reportActionText: { color: "#B42318", fontSize: 13, fontWeight: "800" },
  });
}
