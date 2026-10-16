import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import {
  listMailAccounts,
  listStoredMail,
  sendMail,
  syncMailAccount,
} from "../connectors/mailApiConnector";
import {
  loadMatrixConversations,
  sendMatrixMessage,
} from "../connectors/matrixConnector";
import {
  listBlockedUserIds,
  loadOpenMediaConversations,
  OpenMediaProfile as OpenMediaProfileData,
  reportConversation,
  searchOpenMediaProfiles,
  sendOpenMediaMessage,
  setUserBlocked,
  startDirectConversation,
  subscribeToOpenMediaMessages,
  unsubscribeFromOpenMediaMessages,
} from "../data/openMediaService";
import {
  deletePost,
  publishPost,
  reportPost,
} from "../data/postService";
import { createClientId } from "../data/openMediaService";
import { normalizeStoredEmail, replySubject } from "../domain/emailNormalization";
import { Conversation } from "../domain/models";
import { FeedMode, SocialPost } from "../domain/posts";
import { initialsFor, maxPostLength } from "../domain/publicPosts";
import { ThemeColors } from "../theme";
import { useOpenMediaTheme } from "../themeContext";
import { FeedView, ClipsView } from "./OpenMediaFeed";
import { OpenMediaMessages } from "./OpenMediaMessages";
import { usePublicFeed } from "./usePublicFeed";
import {
  OpenMediaProfile,
  OpenMediaSearch,
  OpenMediaSettings,
} from "./OpenMediaUtilities";

export type PrimaryDestination = "feed" | "clips" | "messages";
export type Destination =
  | PrimaryDestination
  | "search"
  | "profile"
  | "settings";

const primary: Array<{
  id: PrimaryDestination;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { id: "feed", label: "Feed", icon: "home-outline" },
  { id: "clips", label: "Clips", icon: "play-outline" },
  { id: "messages", label: "Messages", icon: "chatbubble-outline" },
];

export type MessageMode = "open_media" | "matrix";

export function OpenMediaApp({
  currentUserId,
  profile,
  onSignOut,
  onAccountDeleted,
  messageMode = "open_media",
}: {
  currentUserId: string;
  profile: OpenMediaProfileData;
  onSignOut: () => Promise<void>;
  onAccountDeleted?: () => void;
  messageMode?: MessageMode;
}) {
  const { width } = useWindowDimensions();
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const compact = width < 760;
  const [destination, setDestination] = useState<Destination>(
    messageMode === "matrix" ? "messages" : "feed",
  );
  const [lastPrimary, setLastPrimary] = useState<PrimaryDestination>(
    messageMode === "matrix" ? "messages" : "feed",
  );
  const [feedMode, setFeedMode] = useState<FeedMode>("relevant");
  const [composeOpen, setComposeOpen] = useState(false);
  const feed = usePublicFeed(currentUserId);
  const canPost = messageMode === "open_media";
  const viewer = useMemo(
    () => ({ id: currentUserId, initials: initialsFor(profile.displayName) }),
    [currentUserId, profile.displayName],
  );
  const removeOwnPost = useCallback(
    async (postId: string) => {
      await deletePost(postId);
      feed.removePost(postId);
    },
    [feed.removePost],
  );
  const [mailConversations, setMailConversations] = useState<
    Conversation[]
  >([]);
  const [nativeConversations, setNativeConversations] = useState<
    Conversation[]
  >([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState("");
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const refreshSequence = useRef(0);
  // One people-first inbox: Open Media chats and email, newest first.
  const conversations = useMemo(
    () =>
      [...nativeConversations, ...mailConversations].sort(
        (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
      ),
    [nativeConversations, mailConversations],
  );
  const refreshMail = useCallback(async () => {
    if (messageMode !== "open_media") return;
    try {
      const [stored, accounts] = await Promise.all([
        listStoredMail(),
        listMailAccounts().catch(() => []),
      ]);
      const sending = new Set(
        accounts.filter((account) => account.canSend).map((account) => account.id),
      );
      setMailConversations(
        normalizeStoredEmail(stored).map((conversation) =>
          conversation.email
            ? { ...conversation, email: { ...conversation.email, canSend: sending.has(conversation.email.accountId) } }
            : conversation,
        ),
      );
    } catch {
      // Email is additive; Open Media chats still load if mail storage is unavailable.
    }
  }, [messageMode]);
  // Show stored email right away, then fetch new mail from every mailbox in the background.
  useEffect(() => {
    if (messageMode !== "open_media") return;
    let active = true;
    const syncAll = async () => {
      try {
        for (const account of await listMailAccounts()) {
          if (!active) return;
          await syncMailAccount(account.id).catch(() => undefined);
        }
      } catch {
        // The mail service may be unreachable; stored email is still shown.
      }
      if (active) await refreshMail();
    };
    refreshMail().then(syncAll);
    const timer = setInterval(syncAll, 5 * 60_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [messageMode, refreshMail]);
  const refreshMessages = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    try {
      const [next, blocked] =
        messageMode === "matrix"
          ? [await loadMatrixConversations(), [] as string[]]
          : await Promise.all([
              loadOpenMediaConversations(currentUserId),
              listBlockedUserIds(),
            ]);
      if (sequence === refreshSequence.current) {
        setMessagesError("");
        setNativeConversations(next);
        setBlockedUserIds(blocked);
      }
    } catch (error) {
      if (sequence === refreshSequence.current)
        setMessagesError(
          error instanceof Error ? error.message : "Could not load messages.",
        );
    } finally {
      if (sequence === refreshSequence.current) setMessagesLoading(false);
    }
  }, [currentUserId, messageMode]);
  useEffect(() => {
    setMessagesLoading(true);
    refreshMessages();
    if (messageMode === "matrix") {
      const timer = setInterval(refreshMessages, 3000);
      return () => clearInterval(timer);
    }
    const channel = subscribeToOpenMediaMessages(refreshMessages);
    return () => {
      unsubscribeFromOpenMediaMessages(channel);
    };
  }, [messageMode, refreshMessages]);
  const sendMessage = useCallback(
    async (conversationId: string, body: string) => {
      const email = mailConversations.find(
        (conversation) => conversation.id === conversationId,
      )?.email;
      if (email) {
        await sendMail(email.accountId, {
          to: [email.address],
          subject: replySubject(email.latestSubject),
          text: body,
          inReplyTo: email.latestMessageId,
        });
        await refreshMail();
        return;
      }
      if (messageMode === "matrix")
        await sendMatrixMessage(conversationId, body);
      else await sendOpenMediaMessage(conversationId, currentUserId, body);
      await refreshMessages();
    },
    [currentUserId, mailConversations, messageMode, refreshMail, refreshMessages],
  );
  const searchProfiles = useCallback(
    (query: string) =>
      messageMode === "matrix"
        ? Promise.resolve([])
        : searchOpenMediaProfiles(query, currentUserId),
    [currentUserId, messageMode],
  );
  const beginConversation = useCallback(
    async (personId: string) => {
      if (messageMode === "matrix")
        throw new Error(
          "Starting new Matrix rooms is reserved for the next bridge phase.",
        );
      const id = await startDirectConversation(personId);
      await refreshMessages();
      return id;
    },
    [messageMode, refreshMessages],
  );
  const updateBlock = useCallback(
    async (personId: string, blocked: boolean) => {
      await setUserBlocked(personId, blocked);
      await Promise.all([refreshMessages(), feed.refresh()]);
    },
    [refreshMessages, feed.refresh],
  );
  const onMailSynced = () => {
    refreshMail();
  };

  const navigate = (next: Destination) => {
    if (primary.some((item) => item.id === next))
      setLastPrimary(next as PrimaryDestination);
    setDestination(next);
  };

  return (
    <View style={[styles.app, compact && styles.appCompact]}>
      {!compact ? (
        <DesktopRail
          destination={destination}
          onNavigate={navigate}
          onCompose={() => setComposeOpen(true)}
        />
      ) : null}
      <View style={styles.content}>
        {compact ? (
          <Header
            destination={destination}
            onNavigate={navigate}
            onBack={() => navigate(lastPrimary)}
          />
        ) : null}
        {destination === "feed" ? (
          <FeedView
            mode={feedMode}
            onModeChange={setFeedMode}
            posts={feed.posts}
            loading={feed.loading}
            error={feed.error}
            hasMore={feed.hasMore}
            onRetry={feed.refresh}
            onLoadMore={feed.loadMore}
            viewer={viewer}
            onCompose={canPost ? () => setComposeOpen(true) : undefined}
            onDeletePost={canPost ? removeOwnPost : undefined}
            onReportPost={canPost ? reportPost : undefined}
          />
        ) : null}
        {destination === "clips" ? <ClipsView /> : null}
        {destination === "messages" ? (
          <OpenMediaMessages
            conversations={conversations}
            loading={messagesLoading}
            error={messagesError}
            messageMode={messageMode}
            blockedUserIds={blockedUserIds}
            onRetry={refreshMessages}
            onSend={sendMessage}
            onSearchProfiles={searchProfiles}
            onStartConversation={beginConversation}
            onSetBlocked={updateBlock}
            onReport={reportConversation}
          />
        ) : null}
        {destination === "search" ? (
          <OpenMediaSearch
            posts={feed.posts}
            conversations={conversations}
            onNavigate={navigate}
          />
        ) : null}
        {destination === "profile" ? (
          <OpenMediaProfile
            profile={profile}
            onNavigate={navigate}
            onSignOut={onSignOut}
            onAccountDeleted={onAccountDeleted}
          />
        ) : null}
        {destination === "settings" ? (
          <OpenMediaSettings
            feedMode={feedMode}
            onFeedModeChange={setFeedMode}
            onMailSynced={onMailSynced}
          />
        ) : null}
      </View>
      {compact && primary.some((item) => item.id === destination) ? (
        <MobileTabs
          destination={destination as PrimaryDestination}
          onNavigate={navigate}
          onCompose={() => setComposeOpen(true)}
        />
      ) : null}
      <ComposeModal
        visible={composeOpen}
        canPublish={canPost}
        onClose={() => setComposeOpen(false)}
        onPublished={(post) => {
          feed.addPost(post);
          setComposeOpen(false);
          navigate("feed");
        }}
      />
    </View>
  );
}

function DesktopRail({
  destination,
  onNavigate,
  onCompose,
}: {
  destination: Destination;
  onNavigate: (value: Destination) => void;
  onCompose: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.rail}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open Media home"
        onPress={() => onNavigate("feed")}
        style={styles.wordmark}
      >
        <BrandIcon />
        <Text style={styles.wordmarkText}>Open Media</Text>
      </Pressable>
      <View style={styles.primary}>
        {primary.map((item) => (
          <NavButton
            key={item.id}
            {...item}
            active={destination === item.id}
            onPress={() => onNavigate(item.id)}
          />
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={onCompose}
        style={styles.create}
      >
        <Ionicons name="add" size={20} color={colors.surface} />
        <Text style={styles.createText}>Create</Text>
      </Pressable>
      <View style={styles.utilities}>
        <NavButton
          id="search"
          label="Search"
          icon="search-outline"
          active={destination === "search"}
          onPress={() => onNavigate("search")}
        />
        <NavButton
          id="profile"
          label="Profile"
          icon="person-outline"
          active={destination === "profile"}
          onPress={() => onNavigate("profile")}
        />
        <NavButton
          id="settings"
          label="Settings"
          icon="settings-outline"
          active={destination === "settings"}
          onPress={() => onNavigate("settings")}
        />
      </View>
    </View>
  );
}

function NavButton({
  label,
  icon,
  active,
  onPress,
}: {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.nav, active && styles.navActive]}
    >
      <Ionicons
        name={icon}
        size={21}
        color={active ? colors.text : colors.textSecondary}
      />
      <Text style={[styles.navText, active && styles.navTextActive]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Header({
  destination,
  onNavigate,
  onBack,
}: {
  destination: Destination;
  onNavigate: (value: Destination) => void;
  onBack: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const utility = !primary.some((item) => item.id === destination);
  return (
    <View style={styles.header}>
      {utility ? (
        <IconButton icon="chevron-back" label="Back" onPress={onBack} />
      ) : (
        <View style={styles.miniBrand}>
          <BrandIcon />
          <Text style={styles.headerBrand}>Open Media</Text>
        </View>
      )}
      <View style={styles.headerRight}>
        {utility ? null : (
          <>
            <IconButton
              icon="search-outline"
              label="Search"
              onPress={() => onNavigate("search")}
            />
            <IconButton
              icon="person-circle-outline"
              label="Profile"
              onPress={() => onNavigate("profile")}
            />
          </>
        )}
      </View>
    </View>
  );
}

function BrandIcon() {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Image source={require("../../assets/icon.png")} style={styles.brandIcon} />
  );
}

export function IconButton({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}
      style={styles.iconButton}
    >
      <Ionicons name={icon} size={22} color={colors.text} />
    </Pressable>
  );
}

function MobileTabs({
  destination,
  onNavigate,
  onCompose,
}: {
  destination: PrimaryDestination;
  onNavigate: (value: Destination) => void;
  onCompose: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.tabs}>
      {primary.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="tab"
          accessibilityState={{ selected: destination === item.id }}
          onPress={() => onNavigate(item.id)}
          style={styles.tab}
        >
          <Ionicons
            name={item.icon}
            size={22}
            color={destination === item.id ? colors.text : colors.textTertiary}
          />
          <Text
            style={[
              styles.tabText,
              destination === item.id && styles.tabTextActive,
            ]}
          >
            {item.label}
          </Text>
        </Pressable>
      ))}
      {destination !== "messages" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Create"
          onPress={onCompose}
          style={styles.floatingCreate}
        >
          <Ionicons name="add" size={25} color={colors.surface} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ComposeModal({
  visible,
  canPublish,
  onClose,
  onPublished,
}: {
  visible: boolean;
  canPublish: boolean;
  onClose: () => void;
  onPublished: (post: SocialPost) => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One client ID per draft keeps retries idempotent on the server.
  const clientId = useRef(createClientId());
  const length = body.trim().length;
  const ready = canPublish && !busy && length > 0 && length <= maxPostLength;
  const publish = async () => {
    setBusy(true);
    setError("");
    try {
      const post = await publishPost(body, clientId.current);
      setBody("");
      clientId.current = createClientId();
      onPublished(post);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Publishing failed.",
      );
    } finally {
      setBusy(false);
    }
  };
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
            <Text style={styles.modalTitle}>Create post</Text>
            <IconButton icon="close" label="Close composer" onPress={onClose} />
          </View>
          <TextInput
            accessibilityLabel="Post text"
            multiline
            autoFocus
            maxLength={maxPostLength + 200}
            value={body}
            onChangeText={setBody}
            placeholder="What’s happening?"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
          />
          {error ? (
            <Text accessibilityLiveRegion="assertive" style={styles.composeError}>
              {error}
            </Text>
          ) : null}
          <View style={styles.publishRow}>
            <View style={styles.publishCopy}>
              <Text style={styles.sharing}>
                {canPublish
                  ? "Public · anyone can read this, with or without an account, including search engines and AI agents"
                  : "Publishing is available with an Open Media account"}
              </Text>
              <Text
                style={[
                  styles.draftOnly,
                  length > maxPostLength && styles.overLimit,
                ]}
              >
                {length}/{maxPostLength}
              </Text>
            </View>
            <Pressable
              disabled={!ready}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready, busy }}
              onPress={publish}
              style={[styles.publish, ready && styles.publishReady]}
            >
              {busy ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={[styles.publishText, ready && styles.publishTextReady]}>
                  Publish
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    app: { flex: 1, flexDirection: "row", backgroundColor: colors.surface },
    appCompact: { flexDirection: "column" },
    content: { flex: 1, minWidth: 0 },
    rail: {
      width: 218,
      padding: 16,
      borderRightWidth: 1,
      borderRightColor: colors.border,
      backgroundColor: colors.surface,
    },
    wordmark: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 10,
    },
    brandIcon: { width: 26, height: 26, borderRadius: 7 },
    wordmarkText: {
      color: colors.text,
      fontSize: 17,
      fontWeight: "800",
      letterSpacing: -0.4,
    },
    primary: { marginTop: 32, gap: 5 },
    nav: {
      minHeight: 46,
      flexDirection: "row",
      alignItems: "center",
      gap: 13,
      paddingHorizontal: 12,
      borderRadius: 12,
    },
    navActive: { backgroundColor: colors.chrome },
    navText: { color: colors.textSecondary, fontSize: 15, fontWeight: "500" },
    navTextActive: { color: colors.text, fontWeight: "700" },
    create: {
      minHeight: 46,
      marginTop: 22,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 23,
      backgroundColor: colors.text,
    },
    createText: { color: colors.surface, fontSize: 14, fontWeight: "700" },
    utilities: { marginTop: "auto", gap: 4 },
    header: {
      minHeight: 56,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      backgroundColor: colors.surface,
    },
    miniBrand: { flexDirection: "row", alignItems: "center", gap: 9 },
    headerBrand: { color: colors.text, fontSize: 17, fontWeight: "800" },
    headerRight: { flexDirection: "row", alignItems: "center" },
    headerTitle: {
      marginRight: 10,
      color: colors.text,
      fontSize: 16,
      fontWeight: "700",
    },
    iconButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 22,
    },
    tabs: {
      minHeight: 68,
      paddingHorizontal: 8,
      flexDirection: "row",
      alignItems: "center",
      borderTopWidth: 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface,
    },
    tab: {
      flex: 1,
      minHeight: 54,
      alignItems: "center",
      justifyContent: "center",
      gap: 3,
    },
    tabText: { color: colors.textTertiary, fontSize: 11, fontWeight: "600" },
    tabTextActive: { color: colors.text },
    floatingCreate: {
      position: "absolute",
      right: 16,
      bottom: 78,
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.text,
      borderWidth: 3,
      borderColor: colors.surface,
    },
    backdrop: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 18,
      backgroundColor: "rgba(0,0,0,0.5)",
    },
    modal: {
      width: "100%",
      maxWidth: 600,
      padding: 20,
      borderRadius: 22,
      backgroundColor: colors.surface,
    },
    modalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    modalTitle: { color: colors.text, fontSize: 18, fontWeight: "800" },
    input: {
      minHeight: 170,
      marginTop: 12,
      paddingVertical: 14,
      color: colors.text,
      fontSize: 18,
      lineHeight: 26,
      textAlignVertical: "top",
      outlineStyle: "none",
    } as object,
    publishRow: {
      paddingTop: 14,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    sharing: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, fontWeight: "500" },
    draftOnly: { marginTop: 4, color: colors.textTertiary, fontSize: 12 },
    publish: {
      minHeight: 40,
      paddingHorizontal: 18,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 20,
      backgroundColor: colors.chrome,
    },
    publishText: {
      color: colors.textTertiary,
      fontSize: 12,
      fontWeight: "700",
    },
    publishReady: { backgroundColor: colors.text },
    publishTextReady: { color: colors.surface },
    publishCopy: { flex: 1 },
    overLimit: { color: colors.danger },
    composeError: { marginTop: 8, color: colors.danger, fontSize: 12 },
  });
}
