import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "./Text";

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
import { deletePost, reportPost } from "../data/postService";
import { bridgedSourceOf, loadBridgedConversations, sendBridgedMessage } from "../connectors/bridgesConnector";
import { normalizeStoredEmail, replySubject } from "../domain/emailNormalization";
import { profileHandleFromPath } from "../domain/profileFields";
import { Conversation, Message } from "../domain/models";
import { useFeedLenses } from "./useFeedLenses";
import { initialsFor } from "../domain/publicPosts";
import { ThemeColors } from "../theme";
import { useOpenMediaTheme } from "../themeContext";
import { ClipsView } from "./ClipsView";
import { SearchView } from "./SearchView";
import { FeedView } from "./OpenMediaFeed";
import { OpenMediaMessages } from "./OpenMediaMessages";
import { useMixedFeed } from "./useMixedFeed";
import {
  OpenMediaProfile,
  OpenMediaSettings,
} from "./OpenMediaUtilities";
import { PeopleProvider, PersonTarget, useContactsStore } from "./people";
import { PersonProfile } from "./PersonProfile";
import { encounterForConversation } from "../domain/people";
import { loadPublicPerson } from "../data/peopleService";
import { apiConfigured } from "../connectors/mailApiConnector";

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

const destinations: Destination[] = ["feed", "clips", "messages", "search", "profile", "settings"];

/** On the web, the section lives in the address bar (#messages) so refresh and back keep your place. */
function destinationFromURL(): Destination | undefined {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  const hash = window.location.hash.replace(/^#/, "") as Destination;
  return destinations.includes(hash) ? hash : undefined;
}

function writeDestinationToURL(destination: Destination) {
  if (Platform.OS !== "web" || typeof window === "undefined") return;
  const target = destination === "feed" ? window.location.pathname : `${window.location.pathname}#${destination}`;
  if (`${window.location.pathname}${window.location.hash}` !== target) window.history.pushState(null, "", target);
}

export function OpenMediaApp({
  currentUserId,
  profile,
  onSignOut,
  onAccountDeleted,
  onProfileChange,
  messageMode = "open_media",
}: {
  currentUserId: string;
  profile: OpenMediaProfileData;
  onSignOut: () => Promise<void>;
  onAccountDeleted?: () => void;
  onProfileChange?: (profile: OpenMediaProfileData) => void;
  messageMode?: MessageMode;
}) {
  const { width } = useWindowDimensions();
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const compact = width < 760;
  const initialDestination: Destination =
    destinationFromURL() ?? (messageMode === "matrix" ? "messages" : "feed");
  const [destination, setDestination] = useState<Destination>(initialDestination);
  const [lastPrimary, setLastPrimary] = useState<PrimaryDestination>(
    primary.some((item) => item.id === initialDestination)
      ? (initialDestination as PrimaryDestination)
      : "feed",
  );
  // Browser back/forward moves between sections.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onPop = () => setDestination(destinationFromURL() ?? "feed");
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const lenses = useFeedLenses(currentUserId);
  const [composeOpen, setComposeOpen] = useState(false);
  const feed = useMixedFeed(currentUserId);
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
  // WhatsApp and other bridged chats (ADR 0011); empty until a network is connected.
  const [bridgedConversations, setBridgedConversations] = useState<
    Conversation[]
  >([]);
  const [messagesLoading, setMessagesLoading] = useState(true);
  const [messagesError, setMessagesError] = useState("");
  const [blockedUserIds, setBlockedUserIds] = useState<string[]>([]);
  const refreshSequence = useRef(0);
  // One people-first inbox: Open Media chats and email, newest first.
  const conversations = useMemo(
    () =>
      [...nativeConversations, ...bridgedConversations, ...mailConversations].sort(
        (a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt),
      ),
    [nativeConversations, bridgedConversations, mailConversations],
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
    let syncing = false;
    const syncAll = async () => {
      if (syncing) return;
      syncing = true;
      try {
        for (const account of await listMailAccounts()) {
          if (!active) return;
          await syncMailAccount(account.id).catch(() => undefined);
        }
      } catch {
        // The mail service may be unreachable; stored email is still shown.
      }
      syncing = false;
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
  const refreshBridged = useCallback(async () => {
    if (messageMode !== "open_media" || !currentUserId) return;
    try {
      setBridgedConversations(await loadBridgedConversations());
    } catch {
      // No bridges on this server, or none connected: nothing to show.
      setBridgedConversations([]);
    }
  }, [currentUserId, messageMode]);
  useEffect(() => {
    refreshBridged();
    const timer = setInterval(refreshBridged, 5000);
    return () => clearInterval(timer);
  }, [refreshBridged]);
  const sendMessage = useCallback(
    async (conversationId: string, body: string, replyTo?: Message) => {
      const email = mailConversations.find(
        (conversation) => conversation.id === conversationId,
      )?.email;
      if (email) {
        // Replying to a specific email threads to it, from the mailbox that received it.
        const target = replyTo?.emailContext;
        await sendMail(target?.accountId ?? email.accountId, {
          to: [target?.address ?? email.address],
          subject: replySubject(target?.subject ?? email.latestSubject),
          text: body,
          inReplyTo: replyTo?.sourceMessageId ?? email.latestMessageId,
        });
        await refreshMail();
        return;
      }
      const bridged = bridgedConversations.find(
        (conversation) => conversation.id === conversationId,
      );
      if (bridged && bridgedSourceOf(bridged)) {
        await sendBridgedMessage(conversationId, body);
        await refreshBridged();
        return;
      }
      if (messageMode === "matrix")
        await sendMatrixMessage(conversationId, body);
      else await sendOpenMediaMessage(conversationId, currentUserId, body, replyTo?.id);
      await refreshMessages();
    },
    [bridgedConversations, currentUserId, mailConversations, messageMode, refreshBridged, refreshMail, refreshMessages],
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

  // Unified profiles (ADR 0013): any name or avatar opens the person, over the current screen.
  // openmedia.site/@handle opens that profile over the app (ADR 0019).
  const [person, setPerson] = useState<PersonTarget | undefined>(() => {
    const handle = Platform.OS === "web" && typeof window !== "undefined" ? profileHandleFromPath(window.location.pathname) : undefined;
    return handle ? { ref: { kind: "open_media", handle } } : undefined;
  });
  const [openConversationId, setOpenConversationId] = useState<string>();
  const encounters = useMemo(
    () => conversations.map(encounterForConversation).filter((item): item is NonNullable<typeof item> => Boolean(item)),
    [conversations],
  );
  const contacts = useContactsStore(messageMode === "open_media" && apiConfigured(), encounters);
  const openPerson = useCallback((target: PersonTarget) => {
    setPerson(target);
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    // An Open Media profile shows its own address, /@handle, so it can be copied and shared.
    const path = target.ref.kind === "open_media" ? `/@${target.ref.handle.replace(/^@/, "").toLowerCase()}` : window.location.pathname;
    window.history.pushState({ person: true }, "", `${path}${window.location.hash}`);
  }, []);
  const closePerson = () => {
    if (Platform.OS === "web" && typeof window !== "undefined" && window.history.state?.person) window.history.back();
    else {
      setPerson(undefined);
      if (Platform.OS === "web" && typeof window !== "undefined" && profileHandleFromPath(window.location.pathname)) window.history.replaceState(null, "", `/${window.location.hash}`);
    }
  };
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const onPop = () => { if (!window.history.state?.person) setPerson(undefined); };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const messagePerson = async (handle: string) => {
    const target = await loadPublicPerson(handle);
    if (!target) return;
    const id = await beginConversation(target.id);
    setPerson(undefined);
    setOpenConversationId(id);
    navigate("messages");
  };
  const people = useMemo(() => ({
    open: openPerson,
    contacts: messageMode === "open_media" ? contacts : undefined,
    message: messageMode === "open_media" ? (handle: string) => { messagePerson(handle).catch(() => undefined); } : undefined,
  }), [openPerson, contacts, messageMode]);

  // Create opens the writing box at the top of Feed; no pop-up.
  const startPost = () => {
    navigate("feed");
    setComposeOpen(true);
  };
  const navigate = (next: Destination) => {
    if (primary.some((item) => item.id === next))
      setLastPrimary(next as PrimaryDestination);
    setDestination(next);
    writeDestinationToURL(next);
  };

  return (
    <PeopleProvider value={people}>
    <View style={[styles.app, compact && styles.appCompact]}>
      {!compact ? (
        <DesktopRail
          destination={destination}
          onNavigate={navigate}
          onCompose={startPost}
        />
      ) : null}
      <View style={styles.content}>
        {compact ? (
          <Header
            destination={destination}
            back={Boolean(person)}
            onNavigate={navigate}
            onBack={person ? closePerson : () => navigate(lastPrimary)}
          />
        ) : null}
        {person ? (
          <PersonProfile
            target={person}
            viewerId={currentUserId}
            onBack={compact ? undefined : closePerson}
            onMessage={messageMode === "open_media" ? (handle) => { messagePerson(handle).catch(() => undefined); } : undefined}
          />
        ) : null}
        {!person && destination === "feed" ? (
          <FeedView
            lens={lenses.lens}
            lenses={lenses.lenses}
            onLensChange={lenses.choose}
            lensContext={lenses.context}
            posts={feed.posts}
            loading={feed.loading}
            error={feed.error}
            hasMore={feed.hasMore}
            onRetry={feed.refresh}
            onLoadMore={feed.loadMore}
            sources={feed.sources}
            loadingMore={feed.loadingMore}
            pendingCount={feed.pendingCount}
            onShowPending={feed.showPending}
            viewer={viewer}
            composing={composeOpen}
            onComposingChange={canPost ? setComposeOpen : undefined}
            onPublished={canPost ? feed.addPost : undefined}
            onDeletePost={canPost ? removeOwnPost : undefined}
            onReportPost={canPost ? reportPost : undefined}
          />
        ) : null}
        {!person && destination === "clips" ? <ClipsView sessionKey={currentUserId} /> : null}
        {!person && destination === "messages" ? (
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
            openConversationId={openConversationId}
          />
        ) : null}
        {!person && destination === "search" ? (
          <SearchView
            posts={feed.posts}
            conversations={conversations}
            viewer={viewer}
            lenses={lenses}
            onNavigate={navigate}
          />
        ) : null}
        {!person && destination === "profile" ? (
          <OpenMediaProfile
            profile={profile}
            onNavigate={navigate}
            onSignOut={onSignOut}
            onAccountDeleted={onAccountDeleted}
            onProfileChange={onProfileChange}
          />
        ) : null}
        {!person && destination === "settings" ? (
          <OpenMediaSettings
            feedLens={lenses.lens.id}
            feedLenses={lenses.lenses}
            onFeedLensChange={lenses.choose}
            onMailSynced={onMailSynced}
          />
        ) : null}
      </View>
      {compact && primary.some((item) => item.id === destination) ? (
        <MobileTabs
          destination={destination as PrimaryDestination}
          onNavigate={navigate}
          onCompose={startPost}
        />
      ) : null}

    </View>
    </PeopleProvider>
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
      <Pressable
        accessibilityRole="search"
        accessibilityLabel="Search everything"
        onPress={() => onNavigate("search")}
        style={[styles.railSearch, destination === "search" && styles.railSearchActive]}
      >
        <Ionicons name="search" size={16} color={colors.textSecondary} />
        <Text style={styles.railSearchText}>Search everything</Text>
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
  back,
  onNavigate,
  onBack,
}: {
  destination: Destination;
  back?: boolean;
  onNavigate: (value: Destination) => void;
  onBack: () => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const utility = back || !primary.some((item) => item.id === destination);
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
  const { colors, isDark } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The transparent mark, dark on light and light on dark (assets/brand).
  return (
    <Image
      source={isDark ? require("../../assets/brand/logo-dark.png") : require("../../assets/brand/logo-light.png")}
      style={styles.brandIcon}
      resizeMode="contain"
    />
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

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    app: { flex: 1, flexDirection: "row", backgroundColor: colors.surface },
    appCompact: { flexDirection: "column" },
    content: { flex: 1, minWidth: 0 },
    railSearch: {
      minHeight: 40,
      marginBottom: 14,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    railSearchActive: { borderColor: colors.text },
    railSearchText: { color: colors.textTertiary, fontSize: 13 },
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
    brandIcon: { width: 22, height: 22 },
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
  });
}
