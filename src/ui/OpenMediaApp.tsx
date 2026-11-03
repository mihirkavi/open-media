import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "./Text";

import {
  apiConfigured,
  getAPIURL,
  listMailAccounts,
  listStoredMail,
  markMailSeen,
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
  markConversationRead,
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
import { bridgedSourceOf, loadBridgedConversations, markBridgedChatRead, sendBridgedMessage } from "../connectors/bridgesConnector";
import { emailConversationId, normalizeStoredEmail, replySubject, subjectFromBody, unreadMailIn } from "../domain/emailNormalization";
import { useLiveMail } from "./useLiveMail";
import { profileHandleFromPath } from "../domain/profileFields";
import { Conversation, Message, Person } from "../domain/models";
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
import { encounterForConversation, ownEmails } from "../domain/people";
import { mergeByContact, recipientSuggestions } from "../domain/contactMerge";
import { AiRecord, aiConversation, isAiConversation } from "../domain/aiChat";
import { loadAiMessages, onAiChatChanged, sendAiMessage } from "../connectors/aiChatConnector";
import { loadPublicPerson } from "../data/peopleService";

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
const shortcutLabel = Platform.OS === "web" && typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K";

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
  // Stored mail, turned into conversations below once the viewer's own addresses are known.
  const [mailStore, setMailStore] = useState<{ stored: Awaited<ReturnType<typeof listStoredMail>>; sending: Set<string> }>({ stored: [], sending: new Set() });
  // Addresses on the viewer's own contact card (ADR 0023), kept in sync with their contacts below.
  const [ownAddresses, setOwnAddresses] = useState<string[]>([]);
  const mailConversations = useMemo(
    () =>
      normalizeStoredEmail(mailStore.stored, { iconService: apiConfigured() ? getAPIURL() : undefined, alsoMine: ownAddresses }).map((conversation) =>
        conversation.email
          ? { ...conversation, email: { ...conversation.email, canSend: mailStore.sending.has(conversation.email.accountId) } }
          : conversation,
      ),
    [mailStore, ownAddresses],
  );
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
  // Mailboxes that can send, for new emails (the first one sends).
  const [sendingMailboxes, setSendingMailboxes] = useState<Array<{ id: string; email: string }>>([]);
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
      setSendingMailboxes(accounts.filter((account) => account.canSend).map((account) => ({ id: account.id, email: account.email })));
      setMailStore({ stored, sending });
    } catch {
      // Email is additive; Open Media chats still load if mail storage is unavailable.
    }
  }, [messageMode]);
  // Show stored email right away; new mail then arrives live while the app is open.
  const [mailAccountsVersion, setMailAccountsVersion] = useState(0);
  useEffect(() => {
    refreshMail();
  }, [refreshMail]);
  useLiveMail(messageMode === "open_media", mailAccountsVersion, refreshMail);
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
  // A conversation on screen is read (ADR 0026), and its unread count clears at once. Each channel
  // records it its own way: Open Media chats in the database, email as read on the mail server, and
  // bridged chats with a Matrix read receipt (private when the person doesn't share receipts).
  const mailStoreRef = useRef(mailStore);
  mailStoreRef.current = mailStore;
  const readConversation = useCallback((conversation: Conversation) => {
    if (messageMode !== "open_media") return;
    const channels = conversation.channels ?? [conversation];
    const ids = channels.filter((channel) => channel.sourceSummary.includes("open_media") && !channel.email).map((channel) => channel.id);
    if (ids.length) {
      setNativeConversations((current) => current.map((item) => (ids.includes(item.id) && item.unreadCount ? { ...item, unreadCount: 0 } : item)));
      ids.forEach((id) => { markConversationRead(id).catch(() => undefined); });
    }
    const mail = unreadMailIn(conversation, mailStoreRef.current.stored);
    if (mail.size) {
      const read = new Set([...mail].flatMap(([accountId, messageIds]) => messageIds.map((id) => `${accountId}:${id}`)));
      setMailStore((current) => ({ ...current, stored: current.stored.map((message) => (message.unread && read.has(`${message.accountId}:${message.sourceMessageId}`) ? { ...message, unread: false } : message)) }));
      mail.forEach((messageIds, accountId) => { markMailSeen(accountId, messageIds).catch(() => undefined); });
    }
    const rooms = channels.filter((channel) => channel.unreadCount && bridgedSourceOf(channel));
    if (rooms.length) {
      const roomIds = rooms.map((room) => room.id);
      setBridgedConversations((current) => current.map((item) => (roomIds.includes(item.id) ? { ...item, unreadCount: 0 } : item)));
      for (const room of rooms) {
        const latest = [...room.messages].reverse().find((message) => message.direction === "inbound" && message.conversationId === room.id);
        if (latest) markBridgedChatRead(room.id, latest.sourceMessageId).catch(() => undefined);
      }
    }
  }, [messageMode]);
  // Pulling down on Messages: every mailbox checks for new mail now, then mail and chats reload.
  const pullMessages = useCallback(async () => {
    const mailboxes = messageMode === "open_media" ? await listMailAccounts().catch(() => []) : [];
    await Promise.all([
      ...mailboxes.map((mailbox) => syncMailAccount(mailbox.id).catch(() => [])),
      refreshMessages(),
    ]);
    await refreshMail();
  }, [messageMode, refreshMail, refreshMessages]);
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
  // Open Media AI (ADR 0028): one AI conversation, refreshed when an AI search adds to it.
  const [aiRecords, setAiRecords] = useState<AiRecord[] | null>(null);
  const refreshAi = useCallback(async () => {
    if (messageMode !== "open_media" || !currentUserId) return;
    try {
      setAiRecords(await loadAiMessages());
    } catch {
      // This server has no AI chat yet: Messages simply doesn't show one.
      setAiRecords(null);
    }
  }, [currentUserId, messageMode]);
  useEffect(() => {
    refreshAi();
    return onAiChatChanged(refreshAi);
  }, [refreshAi]);
  const sendMessage = useCallback(
    async (conversationId: string, body: string, replyTo?: Message) => {
      if (isAiConversation({ id: conversationId })) {
        const added = await sendAiMessage(body);
        setAiRecords((current) => [...(current ?? []), ...added]);
        return;
      }
      const email = mailConversations.find(
        (conversation) => conversation.id === conversationId,
      )?.email;
      if (email) {
        // Replying to a specific email threads to it, from the mailbox that received it. In a
        // group, it goes to whoever wrote that email, with everyone else in Cc (reply all).
        const target = replyTo?.emailContext;
        const others = email.recipients ?? [];
        const primary = others.length > 1 && replyTo?.direction !== "inbound" ? email.address : target?.address ?? email.address;
        await sendMail(target?.accountId ?? email.accountId, {
          to: [primary],
          ...(others.length > 1 ? { cc: others.filter((address) => address !== primary) } : {}),
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
  // A new email written like a message: the first line becomes the subject.
  const sendNewEmail = useCallback(
    async (addresses: string[], body: string) => {
      const mailbox = sendingMailboxes[0];
      if (!mailbox) throw new Error("Add outgoing mail (SMTP) to a mailbox in Settings → Connections to send email.");
      await sendMail(mailbox.id, { to: addresses, subject: subjectFromBody(body), text: body });
      await refreshMail();
      return emailConversationId(addresses);
    },
    [refreshMail, sendingMailboxes],
  );
  // People you have emailed with, for the To field's suggestions.
  const emailContacts = useMemo(
    () => {
      const seen = new Map<string, Person>();
      // Notes to yourself aren't someone you emailed; your own addresses come from your card instead.
      for (const conversation of mailConversations) for (const person of conversation.email?.toSelf ? [] : conversation.participants) {
        const address = person.identities.find((identity) => identity.kind === "email")?.value;
        if (address && !seen.has(address)) seen.set(address, person);
      }
      return [...seen.entries()].map(([address, person]) => ({ address, name: person.name, avatarUrls: person.avatarUrls ?? [], initials: person.initials }));
    },
    [mailConversations],
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
    setMailAccountsVersion((version) => version + 1);
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
  const ownKey = ownEmails(contacts.cards).join(",");
  useEffect(() => setOwnAddresses(ownKey ? ownKey.split(",") : []), [ownKey]);
  // One conversation per person (ADR 0023): chats and email from a contact's identities join up.
  const personConversations = useMemo(
    () => {
      if (messageMode !== "open_media") return conversations;
      const people = mergeByContact(conversations, contacts.cards, profile.displayName);
      // The AI chat always comes first.
      return aiRecords ? [aiConversation(aiRecords, currentUserId), ...people] : people;
    },
    [aiRecords, contacts.cards, conversations, currentUserId, messageMode, profile.displayName],
  );
  // The To field offers saved contacts under their names, then everyone you have emailed.
  const recipientContacts = useMemo(() => recipientSuggestions(emailContacts, contacts.cards, profile.displayName), [contacts.cards, emailContacts, profile.displayName]);
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
  const [searchQuery, setSearchQuery] = useState("");
  const people = useMemo(() => ({
    open: openPerson,
    contacts: messageMode === "open_media" ? contacts : undefined,
    me: { id: currentUserId, handle: profile.handle, name: profile.displayName },
    message: messageMode === "open_media" ? (handle: string) => { messagePerson(handle).catch(() => undefined); } : undefined,
    search: (query: string) => { setPerson(undefined); setSearchQuery(query); navigate("search"); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [openPerson, contacts, messageMode, currentUserId, profile.handle, profile.displayName]);

  // ⌘K (Ctrl+K elsewhere) opens universal search from anywhere on the web, as in most apps.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      setPerson(undefined);
      navigate("search");
      // Already on Search: put the cursor back in its field with the last search selected, as Spotlight does.
      setTimeout(() => { const field = document.querySelector('input[aria-label="Search"]') as HTMLInputElement | null; field?.focus(); field?.select(); }, 50);
    };
    // Capture: text fields stop key events from reaching the window, and ⌘K must work while typing.
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          avatarUrl={profile.avatarUrl}
          onNavigate={navigate}
          onCompose={startPost}
        />
      ) : null}
      <View style={styles.content}>
        {compact ? (
          <Header
            destination={destination}
            avatarUrl={profile.avatarUrl}
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
            conversations={personConversations}
            loading={messagesLoading}
            error={messagesError}
            messageMode={messageMode}
            blockedUserIds={blockedUserIds}
            onRetry={refreshMessages}
            onRefresh={pullMessages}
            onRead={readConversation}
            onSend={sendMessage}
            onSearchProfiles={searchProfiles}
            onStartConversation={beginConversation}
            onSendNewEmail={sendNewEmail}
            emailFrom={sendingMailboxes[0]?.email}
            emailContacts={recipientContacts}
            onSetBlocked={updateBlock}
            onReport={reportConversation}
            openConversationId={openConversationId}
          />
        ) : null}
        {!person && destination === "search" ? (
          <SearchView
            initialQuery={searchQuery}
            posts={feed.posts}
            conversations={personConversations}
            viewer={viewer}
            lenses={lenses}
            onNavigate={navigate}
            onOpenConversation={(id) => { setOpenConversationId(id); navigate("messages"); }}
            onDismiss={() => navigate(lastPrimary)}
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
            lenses={lenses}
            signedIn={Boolean(currentUserId)}
            posts={feed.posts}
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
  avatarUrl,
  onNavigate,
  onCompose,
}: {
  destination: Destination;
  /** The person's profile picture, shown in place of the Profile icon once they add one. */
  avatarUrl?: string;
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
        {/* One way into Search, with its shortcut; the only search field is on the Search page itself. */}
        <NavButton
          id="search"
          label="Search"
          icon="search-outline"
          hint={Platform.OS === "web" ? shortcutLabel : undefined}
          active={destination === "search"}
          onPress={() => onNavigate("search")}
        />
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
          id="profile"
          label="Profile"
          icon="person-outline"
          avatarUrl={avatarUrl}
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
  avatarUrl,
  hint,
  active,
  onPress,
}: {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** A picture drawn in the icon's place, ringed when the item is active. */
  avatarUrl?: string;
  /** A keyboard shortcut, shown as a key on the right. */
  hint?: string;
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
      {avatarUrl ? (
        <View style={[styles.navAvatarRing, active && styles.navAvatarRingActive]}>
          <Image source={{ uri: avatarUrl }} style={styles.navAvatar} accessibilityIgnoresInvertColors />
        </View>
      ) : (
        <Ionicons
          name={icon}
          size={21}
          color={active ? colors.text : colors.textSecondary}
        />
      )}
      <Text style={[styles.navText, active && styles.navTextActive]}>
        {label}
      </Text>
      {hint ? <Text style={styles.navHint}>{hint}</Text> : null}
    </Pressable>
  );
}

function Header({
  destination,
  avatarUrl,
  back,
  onNavigate,
  onBack,
}: {
  destination: Destination;
  avatarUrl?: string;
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
            {avatarUrl ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Profile"
                hitSlop={8}
                onPress={() => onNavigate("profile")}
                style={styles.iconButton}
              >
                <View style={styles.navAvatarRing}>
                  <Image source={{ uri: avatarUrl }} style={styles.headerAvatar} accessibilityIgnoresInvertColors />
                </View>
              </Pressable>
            ) : (
              <IconButton
                icon="person-circle-outline"
                label="Profile"
                onPress={() => onNavigate("profile")}
              />
            )}
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
    // A hairline ring keeps light and dark pictures from melting into the rail; it darkens when active.
    navAvatarRing: { padding: 1.5, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    navAvatarRingActive: { borderWidth: 1.5, borderColor: colors.text, padding: 1 },
    navAvatar: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.chrome },
    headerAvatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.chrome },
    navText: { color: colors.textSecondary, fontSize: 15, fontWeight: "500" },
    navTextActive: { color: colors.text, fontWeight: "700" },
    navHint: { marginLeft: "auto", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, color: colors.textTertiary, fontSize: 11, fontWeight: "600" },
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
