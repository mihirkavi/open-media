import {
  RealtimeChannel,
  Session,
  SupabaseClient,
} from "@supabase/supabase-js";

import { Conversation, Message, Person } from "../domain/models";
import { isEmptyProfessional, parseProfessional, ProfessionalProfile, toJsonResume } from "../domain/professionalProfile";
import { getSupabaseClient } from "../auth/supabase";

export interface OpenMediaProfile {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  /** The work side of the profile (ADR 0018); empty when not filled in. */
  professional?: ProfessionalProfile;
}

interface ProfileRow {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  professional?: unknown;
}
/** What anyone may see about another person (open_media_profile_cards): never a withheld name. */
interface ProfileCard {
  id: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  verified: boolean;
}
interface ConversationRow {
  id: string;
  kind: "direct" | "group";
  title: string | null;
  created_at: string;
  updated_at: string;
}
interface MembershipRow {
  conversation_id: string;
  user_id: string;
}
interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  client_id: string;
  body: string;
  transport: "open_media" | "email";
  created_at: string;
  reply_to_message_id: string | null;
}

function requireClient(): SupabaseClient {
  const client = getSupabaseClient();
  if (!client) throw new Error("Open Media is not connected to its backend.");
  return client;
}

export async function getCurrentProfile(
  session: Session,
): Promise<OpenMediaProfile | undefined> {
  const { data, error } = await requireClient()
    .from("profiles")
    .select("id, handle, display_name, bio, avatar_url, professional")
    .eq("id", session.user.id)
    .maybeSingle();
  if (error) throw error;
  return data ? profileFromRow(data as ProfileRow) : undefined;
}

export async function saveCurrentProfile(
  session: Session,
  input: { displayName: string; handle: string },
): Promise<OpenMediaProfile> {
  const displayName = input.displayName.trim();
  const handle = input.handle.trim().toLowerCase().replace(/^@/, "");
  if (!displayName) throw new Error("Enter your name.");
  if (!/^[a-z0-9_]{3,24}$/.test(handle))
    throw new Error(
      "Use 3–24 lowercase letters, numbers, or underscores for your handle.",
    );
  const { data, error } = await requireClient()
    .from("profiles")
    .upsert(
      { id: session.user.id, display_name: displayName, handle },
      { onConflict: "id" },
    )
    .select("id, handle, display_name, bio, avatar_url")
    .single();
  if (error?.code === "23505") throw new Error("That handle is already taken.");
  if (error) throw error;
  return profileFromRow(data as ProfileRow);
}

export async function searchOpenMediaProfiles(
  query: string,
  _currentUserId: string,
): Promise<Person[]> {
  const cleaned = query.trim().replace(/^@/, "").slice(0, 40);
  if (cleaned.length < 2) return [];
  // The server applies blocks and returns only the name each person chose to show.
  const { data, error } = await requireClient().rpc("open_media_search_profiles", { p_query: cleaned });
  if (error) throw error;
  return ((data ?? []) as ProfileCard[]).map(personFromCard);
}

export async function listBlockedUserIds(): Promise<string[]> {
  const { data, error } = await requireClient()
    .from("user_blocks")
    .select("blocked_id");
  if (error) throw error;
  return ((data ?? []) as Array<{ blocked_id: string }>).map(
    (row) => row.blocked_id,
  );
}

export async function setUserBlocked(
  userId: string,
  blocked: boolean,
): Promise<void> {
  const { error } = await requireClient().rpc("open_media_set_user_blocked", {
    p_blocked_user_id: userId,
    p_blocked: blocked,
  });
  if (error) throw error;
}

export async function reportConversation(
  conversationId: string,
  reportedUserId: string,
  messageId?: string,
): Promise<void> {
  const { error } = await requireClient().rpc(
    "open_media_report_conversation",
    {
      p_conversation_id: conversationId,
      p_reported_user_id: reportedUserId,
      p_message_id: messageId ?? null,
      p_reason: "unwanted_contact",
      p_details: "",
    },
  );
  if (error) throw error;
}

export async function deleteCurrentAccount(): Promise<void> {
  const client = requireClient();
  // Stored email attachments are files, not rows; remove them before the account.
  const { data: auth } = await client.auth.getUser();
  if (auth.user) await removeStorageFolder(client, "mail-attachments", auth.user.id);
  const { error } = await client.rpc("open_media_delete_account");
  if (error) throw error;
  await client.auth.signOut({ scope: "local" });
}

export async function exportCurrentAccountData(): Promise<
  Record<string, unknown>
> {
  const { data, error } = await requireClient().rpc(
    "open_media_export_account_data",
  );
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new Error("Open Media could not prepare your data export.");
  const exported = data as Record<string, unknown>;
  // The professional profile also comes as a JSON Resume document, for resume tools (ADR 0018).
  const profile = exported.profile as { handle?: string; display_name?: string; professional?: unknown } | null;
  const professional = professionalFrom(profile?.professional);
  return professional && profile?.handle && !isEmptyProfessional(professional)
    ? { ...exported, jsonResume: toJsonResume(professional, { name: profile.display_name ?? profile.handle, handle: profile.handle }) }
    : exported;
}

export async function startDirectConversation(
  otherUserId: string,
): Promise<string> {
  const { data, error } = await requireClient().rpc(
    "open_media_start_direct_conversation",
    { p_other_user_id: otherUserId },
  );
  if (error) throw error;
  return data as string;
}

export async function sendOpenMediaMessage(
  conversationId: string,
  senderId: string,
  body: string,
  replyToMessageId?: string,
): Promise<void> {
  const trimmed = body.trim();
  if (!trimmed) return;
  if (trimmed.length > 8000)
    throw new Error("Messages can be up to 8,000 characters.");
  const { error } = await requireClient().from("messages").insert({
    conversation_id: conversationId,
    sender_id: senderId,
    client_id: createClientId(),
    body: trimmed,
    transport: "open_media",
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {}),
  });
  if (error) throw error;
}

export async function loadOpenMediaConversations(
  currentUserId: string,
): Promise<Conversation[]> {
  const client = requireClient();
  const { data: ownMemberships, error: membershipError } = await client
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", currentUserId);
  if (membershipError) throw membershipError;
  const conversationIds = (
    (ownMemberships ?? []) as Array<{ conversation_id: string }>
  ).map((row) => row.conversation_id);
  if (!conversationIds.length) return [];

  const [conversationResult, membersResult, messagesResult] = await Promise.all(
    [
      client
        .from("conversations")
        .select("id, kind, title, created_at, updated_at")
        .in("id", conversationIds)
        .order("updated_at", { ascending: false }),
      client
        .from("conversation_members")
        .select("conversation_id, user_id")
        .in("conversation_id", conversationIds),
      client
        .from("messages")
        .select(
          "id, conversation_id, sender_id, client_id, body, transport, created_at, reply_to_message_id",
        )
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true }),
    ],
  );
  if (conversationResult.error) throw conversationResult.error;
  if (membersResult.error) throw membersResult.error;
  if (messagesResult.error) throw messagesResult.error;

  const rows = (membersResult.data ?? []) as MembershipRow[];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  const { data: profileData, error: profileError } = userIds.length
    ? await client.rpc("open_media_profile_cards", { p_ids: userIds })
    : { data: [], error: null };
  if (profileError) throw profileError;
  const profiles = new Map(
    ((profileData ?? []) as ProfileCard[]).map((card) => [card.id, card]),
  );
  const messages = (messagesResult.data ?? []) as MessageRow[];

  return ((conversationResult.data ?? []) as ConversationRow[])
    .map((conversation) => {
      const participantRows = rows.filter(
        (row) =>
          row.conversation_id === conversation.id &&
          row.user_id !== currentUserId,
      );
      const participants = participantRows
        .map((row) => profiles.get(row.user_id))
        .filter((card): card is ProfileCard => Boolean(card))
        .map(personFromCard);
      const conversationMessages = messages
        .filter((message) => message.conversation_id === conversation.id)
        .map((message) => mapMessage(message, currentUserId, participantRows));
      const lastMessage = conversationMessages[conversationMessages.length - 1];
      return {
        id: conversation.id,
        groupTitle:
          conversation.kind === "group"
            ? (conversation.title ?? "Group")
            : undefined,
        participants,
        messages: conversationMessages,
        sourceSummary: ["open_media"],
        lastMessageAt: lastMessage?.sentAt ?? conversation.created_at,
        preview: lastMessage?.body ?? "Start the conversation.",
        unreadCount: 0,
        labels: conversation.kind === "group" ? ["Group"] : [],
      } satisfies Conversation;
    })
    .sort(
      (left, right) =>
        new Date(right.lastMessageAt).getTime() -
        new Date(left.lastMessageAt).getTime(),
    );
}

export function subscribeToOpenMediaMessages(
  onChange: () => void,
): RealtimeChannel {
  return requireClient()
    .channel("open-media-messages")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      onChange,
    )
    .subscribe();
}

export async function unsubscribeFromOpenMediaMessages(
  channel: RealtimeChannel,
): Promise<void> {
  await requireClient().removeChannel(channel);
}

function profileFromRow(row: ProfileRow): OpenMediaProfile {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined,
    professional: professionalFrom(row.professional),
  };
}

function professionalFrom(value: unknown): ProfessionalProfile | undefined {
  try { return value === undefined ? undefined : parseProfessional(value); } catch { return undefined; }
}

/** Saves the work side of the signed-in person's profile; the database checks it again. */
export async function saveProfessionalProfile(profile: ProfessionalProfile): Promise<ProfessionalProfile> {
  const clean = parseProfessional(profile);
  const { data, error } = await requireClient().rpc("open_media_set_professional_profile", { p_professional: clean });
  if (error) throw error;
  return parseProfessional(data);
}

/** The signed-in person's own professional profile, read fresh. */
export async function loadProfessionalProfile(): Promise<ProfessionalProfile | undefined> {
  const client = requireClient();
  const { data: auth } = await client.auth.getUser();
  if (!auth.user) return undefined;
  const { data, error } = await client.from("profiles").select("professional").eq("id", auth.user.id).maybeSingle();
  if (error) throw error;
  return professionalFrom((data as { professional?: unknown } | null)?.professional);
}

function personFromCard(card: ProfileCard): Person {
  return {
    ...personFromProfile({ id: card.id, handle: card.handle, display_name: card.displayName, bio: "", avatar_url: card.avatarUrl }),
    verified: card.verified,
  };
}

function personFromProfile(row: ProfileRow): Person {
  const initials =
    row.display_name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "OM";
  return {
    id: row.id,
    name: row.display_name,
    initials,
    avatarColor: "#111111",
    identities: [
      {
        id: `open-media-${row.id}`,
        personId: row.id,
        kind: "handle",
        value: `@${row.handle}`,
        source: "open_media",
        label: "Open Media",
        verifiedByUser: true,
      },
    ],
  };
}

function mapMessage(
  row: MessageRow,
  currentUserId: string,
  participantRows: MembershipRow[],
): Message {
  const outbound = row.sender_id === currentUserId;
  return {
    id: row.id,
    sourceMessageId: row.id,
    conversationId: row.conversation_id,
    senderPersonId: row.sender_id,
    senderIdentityId: `open-media-${row.sender_id}`,
    recipientPersonIds: participantRows.map((member) => member.user_id),
    sentAt: row.created_at,
    body: row.body,
    source: row.transport === "email" ? "imap" : "open_media",
    channel: row.transport === "email" ? "email" : "native",
    direction: outbound ? "outbound" : "inbound",
    deliveryState: outbound ? "sent" : "received",
    ...(row.reply_to_message_id ? { replyToMessageId: row.reply_to_message_id } : {}),
  };
}

export function createClientId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function")
    return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
    /[xy]/g,
    (character) => {
      const random = Math.floor(Math.random() * 16);
      const value = character === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    },
  );
}

async function removeStorageFolder(client: SupabaseClient, bucket: string, folder: string, depth = 0): Promise<void> {
  const { data, error } = await client.storage.from(bucket).list(folder, { limit: 1000 });
  if (error || !data) return;
  const files = data.filter((entry) => entry.id).map((entry) => `${folder}/${entry.name}`);
  if (files.length) await client.storage.from(bucket).remove(files);
  if (depth < 3) {
    for (const entry of data.filter((item) => !item.id)) await removeStorageFolder(client, bucket, `${folder}/${entry.name}`, depth + 1);
  }
}
