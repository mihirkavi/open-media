import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { formatEmailBody } from "../domain/emailBody";
import { formatListTime, layoutThread } from "../domain/threadLayout";
import { Conversation, Message, PeopleFilter, Person } from "../domain/models";
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
                : "Everyone you talk to, in one place."}
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
        {newMessageOpen && messageMode === "open_media" ? (
          <NewMessagePanel
            onClose={() => setNewMessageOpen(false)}
            onSearch={onSearchProfiles}
            onStart={async (personId) => {
              const id = await onStartConversation(personId);
              setSelectedId(id);
              setNewMessageOpen(false);
            }}
          />
        ) : <>
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
          style={styles.filterBar}
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
                  imageUrls={conversation.participants[0]?.avatarUrls}
                  size={48}
                />
                <View style={styles.rowCopy}>
                  <View style={styles.rowTitleLine}>
                    <Text numberOfLines={1} style={styles.rowTitle}>
                      {conversationTitle(conversation)}
                    </Text>
                    {conversation.participants[0]?.verifiedDomain ? <VerifiedBadge domain={conversation.participants[0].verifiedDomain} /> : null}
                    {conversation.unreadCount ? (
                      <View style={styles.unread} />
                    ) : null}
                    <Text style={styles.rowTime}>{formatListTime(new Date(conversation.lastMessageAt))}</Text>
                  </View>
                  <Text numberOfLines={2} style={styles.preview}>
                    {conversation.preview}
                  </Text>
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
        </>}
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
      conversation.sourceSummary.includes("matrix") ||
      Boolean(conversation.email?.canSend));
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
          <Avatar
            initials={otherPerson?.initials ?? "OM"}
            imageUrls={otherPerson?.avatarUrls}
            size={44}
          />
          <View style={[styles.rowTitleLine, styles.threadNameLine]}>
            <Text numberOfLines={1} style={styles.threadTitle}>
              {conversationTitle(conversation)}
            </Text>
            {otherPerson?.verifiedDomain ? <VerifiedBadge domain={otherPerson.verifiedDomain} /> : null}
          </View>
          <Text numberOfLines={1} style={styles.threadMeta}>
            {blocked
              ? "Blocked · messaging paused"
              : throughMatrix
              ? "Matrix · local development sandbox"
              : conversation.email
                ? `${otherPerson?.verifiedDomain ? `Verified sender · ${otherPerson.verifiedDomain}` : `Email · ${conversation.email.address}`} · via ${conversation.email.accountEmail}${conversation.email.canSend ? "" : " (receive only)"}`
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
          layoutThread(conversation.messages).map((item) =>
            item.kind === "time" ? (
              <Text key={item.key} style={styles.timeSeparator}>
                {item.label}
              </Text>
            ) : (
              <View
                key={item.key}
                style={[
                  styles.messageWrap,
                  item.message.direction === "outbound" && styles.outboundWrap,
                  item.groupStart && styles.groupStart,
                ]}
              >
                <View
                  style={[
                    styles.bubble,
                    item.message.direction === "outbound" && styles.outboundBubble,
                    item.groupEnd && (item.message.direction === "outbound" ? styles.outboundTail : styles.inboundTail),
                  ]}
                >
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
                  ) : (
                    <Text
                      style={[
                        styles.message,
                        item.message.direction === "outbound" && styles.outboundMessage,
                      ]}
                    >
                      {item.message.body}
                    </Text>
                  )}
                </View>
                {item.groupEnd && conversation.sourceSummary.length > 1 ? (
                  <View style={[styles.bubbleSource, item.message.direction === "outbound" && styles.outboundWrap]}>
                    <SourceMarker source={item.message.source} showLabel />
                  </View>
                ) : null}
              </View>
            ),
          )
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
              placeholder={
                conversation.email
                  ? `Reply by email from ${conversation.email.accountEmail}`
                  : throughMatrix
                    ? "Message through Matrix"
                    : "Message"
              }
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
              : conversation.email
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

/** Find someone on Open Media, right in the conversation list (no pop-up). */
function NewMessagePanel({
  onClose,
  onSearch,
  onStart,
}: {
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
  }, [query, onSearch]);
  return (
        <View style={styles.newPanel}>
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
  if (url) {
    return (
      <View style={[styles.avatarFrame, dimension]}>
        <Image
          accessibilityIgnoresInvertColors
          source={{ uri: url }}
          onError={() => setIndex((value) => value + 1)}
          resizeMode="cover"
          style={dimension}
        />
      </View>
    );
  }
  return (
    <View style={[styles.avatar, dimension]}>
      <Text style={[styles.avatarText, { fontSize: Math.round(size * 0.32) }]}>{initials}</Text>
    </View>
  );
}

/** Blue check for senders that passed DMARC and publish a BIMI mark certificate. */
function VerifiedBadge({ domain }: { domain: string }) {
  return (
    <Ionicons
      accessibilityLabel={`Verified sender: ${domain}`}
      name="checkmark-circle"
      size={16}
      color="#1D9BF0"
    />
  );
}

/** Email shown like a message: links as words, quoted history hidden, long mail collapsed. */
function EmailBody({ message }: { message: Message }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const formatted = useMemo(() => formatEmailBody(message.body), [message.body]);
  const long = formatted.plain.length > 700 || formatted.plain.split("\n").length > 14;
  const [expanded, setExpanded] = useState(false);
  const outbound = message.direction === "outbound";
  return (
    <View>
      <Text
        numberOfLines={long && !expanded ? 14 : undefined}
        style={[styles.message, outbound && styles.outboundMessage]}
      >
        {formatted.segments.map((segment, index) =>
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
      backgroundColor: colors.chrome,
    },
    matrixBadgeText: {
      color: colors.textSecondary,
      fontSize: 10,
      fontWeight: "700",
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
    rowActive: { backgroundColor: colors.chrome },
    rowTime: { marginLeft: "auto", color: colors.textTertiary, fontSize: 12 },
    avatarFrame: { overflow: "hidden", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.text,
    },
    avatarText: { color: colors.surface, fontSize: 12, fontWeight: "700" },
    avatarImage: { backgroundColor: colors.chrome },
    emailLink: { color: colors.text, textDecorationLine: "underline", fontWeight: "600" },
    showMore: { marginTop: 8, color: colors.textSecondary, fontSize: 13, fontWeight: "700" },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitleLine: { flexDirection: "row", alignItems: "center", gap: 7 },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
    unread: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    preview: { marginTop: 2, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    threadPane: { flex: 1, minWidth: 0 },
    thread: { flex: 1, backgroundColor: colors.surface },
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
    bubble: {
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 20,
      backgroundColor: colors.bubble,
    },
    outboundBubble: { backgroundColor: colors.text },
    inboundTail: { borderBottomLeftRadius: 6 },
    outboundTail: { borderBottomRightRadius: 6 },
    bubbleSubject: { marginBottom: 3, color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: "700" },
    bubbleSource: { marginTop: 4, marginHorizontal: 6, alignSelf: "flex-start" },
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
    composerError: { marginBottom: 6, color: colors.danger, fontSize: 12 },
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
