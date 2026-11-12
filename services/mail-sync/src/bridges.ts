/**
 * Bridged messaging (ADR 0011): WhatsApp and other networks through mautrix
 * bridges on Open Media's private Matrix homeserver.
 *
 * Each signed-in person maps to exactly one Matrix user, @om_<their id>, which
 * only Open Media's application service can act as. Every call below acts as
 * that user, so the homeserver itself keeps people's chats apart: a person can
 * only list, read and send in rooms their own Matrix user has joined.
 */
import { UserFacingError } from './errors.js';

export interface BridgesEnv {
  BRIDGES_HOMESERVER_URL?: string;
  BRIDGES_SERVER_NAME?: string;
  BRIDGES_AS_TOKEN?: string;
  BRIDGES_PROVISIONING_SECRET?: string;
  BRIDGES_WHATSAPP_URL?: string;
  BRIDGES_TELEGRAM_URL?: string;
  BRIDGES_SIGNAL_URL?: string;
  BRIDGES_GMESSAGES_URL?: string;
  BRIDGES_INSTAGRAM_URL?: string;
  BRIDGES_MESSENGER_URL?: string;
  BRIDGES_LINKEDIN_URL?: string;
  BRIDGES_TWITTER_URL?: string;
  BRIDGES_BLUESKY_URL?: string;
  BRIDGES_SLACK_URL?: string;
  BRIDGES_DISCORD_URL?: string;
  BRIDGES_GVOICE_URL?: string;
}

/**
 * `legacy` marks a bridge that still uses the older provisioning API (Discord's
 * current release); the others use the shared bridgev2 login API. `protocols`
 * lists the ids a bridge may put in its rooms' m.bridge event when they differ
 * from Open Media's (Meta's Messenger build says "facebook").
 */
/** Networks whose accounts are phone numbers (matches the app's `phoneNetworks`). */
const phoneNetworks = new Set(['whatsapp', 'signal', 'gmessages', 'gvoice']);

/** "+1 (669) 325-7689" → "+16693257689"; anything that isn't only a phone number → undefined. */
function phoneLabel(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^\+?[\d\s().\u2010-\u2015-]{7,24}$/.test(value.trim())) return undefined;
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined;
  return `${value.trim().startsWith('+') ? '+' : ''}${digits}`;
}

type NetworkConfig = { name: string; url: keyof BridgesEnv; ghost: string; bot: string; legacy?: boolean; protocols?: string[] };

/** Networks Open Media can bridge. Only those with a configured bridge URL are offered. */
export const bridgeNetworks: Record<string, NetworkConfig> = {
  whatsapp: { name: 'WhatsApp', url: 'BRIDGES_WHATSAPP_URL', ghost: 'whatsapp_', bot: 'whatsappbot' },
  telegram: { name: 'Telegram', url: 'BRIDGES_TELEGRAM_URL', ghost: 'telegram_', bot: 'telegrambot' },
  signal: { name: 'Signal', url: 'BRIDGES_SIGNAL_URL', ghost: 'signal_', bot: 'signalbot' },
  gmessages: { name: 'Google Messages', url: 'BRIDGES_GMESSAGES_URL', ghost: 'gmessages_', bot: 'gmessagesbot' },
  gvoice: { name: 'Google Voice', url: 'BRIDGES_GVOICE_URL', ghost: 'gvoice_', bot: 'gvoicebot' },
  instagram: { name: 'Instagram', url: 'BRIDGES_INSTAGRAM_URL', ghost: 'instagram_', bot: 'instagrambot' },
  messenger: { name: 'Messenger', url: 'BRIDGES_MESSENGER_URL', ghost: 'messenger_', bot: 'messengerbot', protocols: ['facebook'] },
  linkedin: { name: 'LinkedIn', url: 'BRIDGES_LINKEDIN_URL', ghost: 'linkedin_', bot: 'linkedinbot' },
  twitter: { name: 'X', url: 'BRIDGES_TWITTER_URL', ghost: 'twitter_', bot: 'twitterbot' },
  bluesky: { name: 'Bluesky', url: 'BRIDGES_BLUESKY_URL', ghost: 'bluesky_', bot: 'blueskybot' },
  slack: { name: 'Slack', url: 'BRIDGES_SLACK_URL', ghost: 'slack_', bot: 'slackbot' },
  discord: { name: 'Discord', url: 'BRIDGES_DISCORD_URL', ghost: 'discord_', bot: 'discordbot', legacy: true, protocols: ['discordgo'] },
};

export interface BridgeLoginStep {
  loginId: string;
  type: 'display_and_wait' | 'user_input' | 'cookies' | 'complete' | 'unsupported';
  stepId: string;
  instructions?: string;
  display?: { type: 'qr' | 'code' | 'emoji' | 'nothing'; data?: string };
  fields?: { id: string; name: string; description?: string; type: string }[];
  /** For cookie sign-ins: the site to sign in to, and where each value comes from. */
  url?: string;
}

export interface BridgeRoomSnapshot {
  id: string;
  network: string;
  name: string;
  /** `phone`: the person's number in a one-to-one chat on a phone-number network, when the chat shows it. */
  members: { id: string; displayName: string; phone?: string }[];
  /** Your own messages carry when every other member's app received them and read them (ADR 0026). */
  events: { id: string; sender: string; body: string; timestamp: number; deliveredAt?: number; readAt?: number }[];
  /** Messages from others after where you last read. */
  unread: number;
}

const idPattern = /^[A-Za-z0-9._:=-]{1,255}$/;

export function bridgesConfigured(env: BridgesEnv): boolean {
  return Boolean(env.BRIDGES_HOMESERVER_URL && env.BRIDGES_SERVER_NAME && env.BRIDGES_AS_TOKEN && env.BRIDGES_PROVISIONING_SECRET);
}

export function availableNetworks(env: BridgesEnv): string[] {
  if (!bridgesConfigured(env)) return [];
  return Object.entries(bridgeNetworks).filter(([, network]) => env[network.url]).map(([id]) => id);
}

/** The Matrix user that stands for this Open Media account. */
export function matrixUserFor(userId: string, env: BridgesEnv): string {
  const hex = userId.toLowerCase().replace(/-/g, '');
  if (!/^[a-f0-9]{32}$/.test(hex)) throw new UserFacingError('This account can’t use bridged chats.');
  return `@om_${hex}:${env.BRIDGES_SERVER_NAME}`;
}

/** Matrix users this isolate already registered or found in use; bounded. */
const registeredUsers = new Set<string>();

export class Bridges {
  private readonly mxid: string;

  constructor(private readonly env: BridgesEnv, userId: string) {
    if (!bridgesConfigured(env)) throw new UserFacingError('Bridged chats aren’t set up on this server yet.');
    this.mxid = matrixUserFor(userId, env);
  }

  /** Creates this person's Matrix user the first time it's needed (once per isolate, not on every 5 s poll). */
  async ensureUser(): Promise<void> {
    if (registeredUsers.has(this.mxid)) return;
    await this.registerUser();
    if (registeredUsers.size >= 5000) registeredUsers.clear();
    registeredUsers.add(this.mxid);
  }

  private async registerUser(): Promise<void> {
    const response = await fetch(`${this.env.BRIDGES_HOMESERVER_URL}/_matrix/client/v3/register`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.env.BRIDGES_AS_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'm.login.application_service', username: this.mxid.slice(1).split(':')[0], inhibit_login: true }),
    });
    if (response.ok) return;
    const body = await response.json().catch(() => ({})) as { errcode?: string };
    if (body.errcode !== 'M_USER_IN_USE') throw new UserFacingError('The chat bridge server isn’t answering. Try again soon.');
  }

  async status() {
    const networks = availableNetworks(this.env);
    const results = await Promise.all(networks.map(async (id) => {
      try {
        if (bridgeNetworks[id].legacy) return { id, name: bridgeNetworks[id].name, available: true, logins: await this.legacyLogins(id) };
        const whoami = await this.provision(id, 'GET', '/v3/whoami') as { logins?: { id: string; name?: string; state?: { state_event?: string } }[] };
        return { id, name: bridgeNetworks[id].name, available: true, logins: (whoami.logins ?? []).map((login) => ({ id: login.id, name: login.name ?? '', state: login.state?.state_event ?? 'UNKNOWN' })) };
      } catch {
        return { id, name: bridgeNetworks[id].name, available: false, logins: [] };
      }
    }));
    return { networks: results };
  }

  async flows(network: string): Promise<{ id: string; name: string; description: string }[]> {
    await this.ensureUser();
    if (bridgeNetworks[network]?.legacy) return [{ id: 'token', name: 'Sign-in token', description: 'Copy your sign-in token from Discord in a desktop browser.' }];
    const result = await this.provision(network, 'GET', '/v3/login/flows') as { flows?: { id?: string; name?: string; description?: string }[] };
    return (result.flows ?? []).map((flow) => ({ id: String(flow.id ?? ''), name: String(flow.name ?? ''), description: String(flow.description ?? '') })).filter((flow) => idPattern.test(flow.id));
  }

  async startLogin(network: string, flow: unknown): Promise<BridgeLoginStep> {
    if (typeof flow !== 'string' || !idPattern.test(flow)) throw new UserFacingError('Choose how to connect.');
    await this.ensureUser();
    if (bridgeNetworks[network]?.legacy) return legacyTokenStep(network);
    return toStep(await this.provision(network, 'POST', `/v3/login/start/${encodeURIComponent(flow)}`));
  }

  async continueLogin(network: string, input: { loginId?: unknown; stepId?: unknown; type?: unknown; values?: unknown }): Promise<BridgeLoginStep> {
    const { loginId, stepId, type, values } = input;
    if (typeof loginId !== 'string' || !idPattern.test(loginId) || typeof stepId !== 'string' || !idPattern.test(stepId)) throw new UserFacingError('That connection attempt expired. Start again.');
    if (type !== 'display_and_wait' && type !== 'user_input' && type !== 'cookies') throw new UserFacingError('That connection step isn’t supported.');
    const body = type === 'display_and_wait' ? undefined : stringValues(values);
    if (bridgeNetworks[network]?.legacy) {
      // Discord's token sign-in finishes in one request; the bridge answers once it has connected.
      if (type !== 'cookies' || !body?.token) throw new UserFacingError('Paste your sign-in token first.');
      await this.provision(network, 'POST', '/v1/login/token', { token: body.token });
      return { loginId, stepId, type: 'complete' };
    }
    return toStep(await this.provision(network, 'POST', `/v3/login/step/${encodeURIComponent(loginId)}/${encodeURIComponent(stepId)}/${type}`, body));
  }

  async cancelLogin(network: string, loginId: unknown): Promise<void> {
    if (typeof loginId !== 'string' || !idPattern.test(loginId) || bridgeNetworks[network]?.legacy) return;
    await this.provision(network, 'POST', `/v3/login/cancel/${encodeURIComponent(loginId)}`).catch(() => undefined);
  }

  async logout(network: string, loginId: unknown): Promise<void> {
    const id = loginId === undefined ? 'all' : loginId;
    if (typeof id !== 'string' || !idPattern.test(id)) throw new UserFacingError('Account not found.');
    if (bridgeNetworks[network]?.legacy) { await this.provision(network, 'POST', '/v1/logout'); return; }
    await this.provision(network, 'POST', `/v3/logout/${encodeURIComponent(id)}`);
  }

  /** Recent bridged chats for this person, newest messages included. */
  async conversations(): Promise<{ userId: string; rooms: BridgeRoomSnapshot[] }> {
    await this.ensureUser();
    const filter = {
      presence: { not_types: ['*'] },
      account_data: { not_types: ['*'] },
      // Synapse answers an identical sync from its response cache, which kept new messages and
      // receipts out of view for minutes. An event type that never exists, changing every 15 s,
      // keeps answers at most that old without recomputing every poll.
      room: { timeline: { limit: 30, not_types: [`org.openmedia.fresh.${Math.floor(Date.now() / 15_000)}`] }, ephemeral: { types: ['m.receipt'] }, account_data: { types: markedUnreadTypes } },
    };
    const sync = await this.matrix('GET', `/_matrix/client/v3/sync?timeout=0&filter=${encodeURIComponent(JSON.stringify(filter))}`) as SyncResponse;
    // New chats from a bridge are joined automatically, in case the bridge couldn't join for us.
    for (const [roomId, room] of Object.entries(sync.rooms?.invite ?? {})) {
      const inviter = room.invite_state?.events?.find((event) => event.type === 'm.room.member' && event.state_key === this.mxid)?.sender ?? '';
      if (this.networkOfUser(inviter)) await this.matrix('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/join`, {}).catch(() => undefined);
    }
    const rooms = Object.entries(sync.rooms?.join ?? {}).map(([roomId, room]) => this.snapshot(roomId, room)).filter((room): room is BridgeRoomSnapshot => room !== null);
    return { userId: this.mxid, rooms };
  }

  /**
   * Reads a chat up to this message (ADR 0026). With read receipts shared, the bridge passes the
   * receipt on to WhatsApp, Signal and the rest; otherwise a private receipt only clears the unread
   * count here and tells no one.
   */
  async markRead(roomId: string, eventId: unknown, share: boolean): Promise<void> {
    if (!roomPattern.test(roomId) || typeof eventId !== 'string' || !/^\$[A-Za-z0-9._~+/=:-]{1,255}$/.test(eventId)) throw new UserFacingError('Chat not found.');
    const type = share ? 'm.read' : 'm.read.private';
    await this.matrix('POST', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/receipt/${type}/${encodeURIComponent(eventId)}`, {});
    // Reading a chat also clears a "marked unread", as the Matrix spec asks of clients.
    await this.setMarkedUnread(roomId, false).catch(() => undefined);
  }

  /**
   * Marks a chat unread for this person (Matrix's `m.marked_unread`), the swipe in Messages. It
   * sends no receipt; bridges that support it, such as WhatsApp's, mark the chat unread there too.
   */
  async markUnread(roomId: string): Promise<void> {
    if (!roomPattern.test(roomId)) throw new UserFacingError('Chat not found.');
    await this.ensureUser();
    await this.setMarkedUnread(roomId, true);
  }

  private async setMarkedUnread(roomId: string, unread: boolean): Promise<void> {
    await this.matrix('PUT', `/_matrix/client/v3/user/${encodeURIComponent(this.mxid)}/rooms/${encodeURIComponent(roomId)}/account_data/m.marked_unread`, { unread });
  }

  async send(roomId: string, body: unknown): Promise<void> {
    if (!roomPattern.test(roomId)) throw new UserFacingError('Chat not found.');
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) throw new UserFacingError('Write a message first.');
    if (text.length > 8000) throw new UserFacingError('Messages can be up to 8,000 characters.');
    const txn = `om${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    await this.matrix('PUT', `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txn}`, { msgtype: 'm.text', body: text });
  }

  private snapshot(roomId: string, room: JoinedRoom): BridgeRoomSnapshot | null {
    const state = [...(room.state?.events ?? []), ...(room.timeline?.events ?? []).filter((event) => event.state_key !== undefined)];
    if (state.some((event) => event.type === 'm.room.create' && event.content?.type === 'm.space')) return null;
    const bridgeInfo = state.find((event) => event.type === 'm.bridge' || event.type === 'uk.half-shot.bridge');
    const members = new Map<string, string>();
    for (const event of state) {
      if (event.type !== 'm.room.member' || !event.state_key) continue;
      if (event.content?.membership === 'join') members.set(event.state_key, String(event.content.displayname ?? event.state_key));
      else members.delete(event.state_key);
    }
    const others = [...members.entries()].filter(([id]) => id !== this.mxid && !this.isBot(id));
    // Open Media names every bridge's users (`whatsapp_…`), so that decides; the room's m.bridge protocol is the fallback.
    const network = others.map(([id]) => this.networkOfUser(id)).find(Boolean) ?? networkOfProtocol((bridgeInfo?.content?.protocol as { id?: string } | undefined)?.id);
    // A bridged chat's m.bridge names its remote chat (`channel.id`). It counts even when the other
    // side never joins: Signal contacts known only by phone number (PNI) have no user in the room.
    const channel = bridgeInfo?.content?.channel as { id?: unknown; displayname?: unknown } | undefined;
    const portal = typeof channel?.id === 'string' && channel.id.length > 0;
    // Management rooms (only the bridge bot) and non-bridged rooms aren't chats.
    if (!network || !bridgeNetworks[network] || (others.length === 0 && !portal)) return null;
    const roomName = state.findLast((event) => event.type === 'm.room.name')?.content?.name;
    const name = typeof roomName === 'string' && roomName
      ? roomName
      : others.length ? others.map(([, displayName]) => displayName).join(', ')
        : typeof channel?.displayname === 'string' && channel.displayname ? channel.displayname : `${bridgeNetworks[network].name} chat`;
    const timeline = room.timeline?.events ?? [];
    const receipts = readReceipts(room);
    const position = (eventId?: string) => (eventId ? timeline.findIndex((event) => event.event_id === eventId) : -1);
    // Delivery from the bridge's message status events, when it sends them.
    const delivered = new Map<string, number>();
    for (const event of timeline) {
      const target = (event.content?.['m.relates_to'] as { event_id?: string } | undefined)?.event_id;
      const to = event.content?.delivered_to_users;
      if (event.type === 'com.beeper.message_send_status' && target && Array.isArray(to) && to.length) delivered.set(target, event.origin_server_ts ?? 0);
    }
    // A message is read once every other member's read receipt is at or past it.
    const readers = others.map(([id]) => receipts.get(id));
    const readUpTo = readers.every(Boolean) && readers.length ? Math.min(...readers.map((receipt) => position(receipt!.eventId))) : -1;
    const readAt = readers.length && readers.every(Boolean) ? Math.min(...readers.map((receipt) => receipt!.ts)) : undefined;
    const events = timeline.flatMap((event, index) => {
      if (event.type !== 'm.room.message' || !event.event_id || !event.sender) return [];
      const body = messageText(event.content ?? {});
      if (!body) return [];
      const item: BridgeRoomSnapshot['events'][number] = { id: event.event_id, sender: event.sender, body, timestamp: event.origin_server_ts ?? 0 };
      if (event.sender === this.mxid) {
        const read = index <= readUpTo && readAt !== undefined ? Math.max(readAt, item.timestamp) : undefined;
        const deliveredAt = read ?? delivered.get(event.event_id);
        if (deliveredAt !== undefined) item.deliveredAt = deliveredAt;
        if (read !== undefined) item.readAt = read;
      }
      return [item];
    });
    // Unread: messages from others after your own receipt or your latest message, whichever is later.
    const own = receipts.get(this.mxid);
    const ownAt = position(own?.eventId);
    const lastSent = timeline.findLastIndex((event) => event.type === 'm.room.message' && event.sender === this.mxid);
    const since = Math.max(ownAt, lastSent);
    const after = timeline.filter((event, index) => index > since && event.type === 'm.room.message' && event.sender !== this.mxid && event.event_id && messageText(event.content ?? {})).length;
    // Nothing of yours among these 30 events: the server's own count, from your receipts, caps it.
    const counted = room.unread_notifications?.notification_count;
    const beforeMark = since < 0 && typeof counted === 'number' ? Math.min(counted, after) : after;
    // A chat the person marked unread counts as one unread until they open it.
    const marked = (room.account_data?.events ?? []).some((event) => markedUnreadTypes.includes(event.type ?? '') && event.content?.unread === true);
    const unread = marked ? Math.max(1, beforeMark) : beforeMark;
    const people = others.length ? others.map(([id, displayName]) => ({ id, displayName })) : this.numberMember(network, channel, roomName);
    return { id: roomId, network, name, members: this.withNumber(network, people, [roomName, channel?.displayname]), events, unread };
  }

  /**
   * Signal and Google Messages name a one-to-one chat with the person's number while their id is a
   * UUID or an internal number. On networks whose accounts are phone numbers, that number goes on
   * the one member as `phone`, so the app finds the saved contact with it (Elad, saved by number,
   * chatting from a Signal account under his profile name).
   */
  private withNumber(network: string, members: { id: string; displayName: string }[], labels: unknown[]): { id: string; displayName: string; phone?: string }[] {
    if (!phoneNetworks.has(network) || members.length !== 1) return members;
    const phone = [...labels, members[0].displayName].map(phoneLabel).find(Boolean);
    return phone ? [{ ...members[0], phone }] : members;
  }

  /**
   * A one-to-one chat whose other side has not joined (Signal contacts known only by number, or
   * someone only invited so far) is named with their phone number. The member is the person's own
   * account from the chat's m.bridge channel when it is one, else `@<ghost>+<digits>`; `withNumber`
   * then adds the number, so the chat joins the saved contact with it.
   */
  private numberMember(network: string, channel: { id?: unknown; displayname?: unknown } | undefined, roomName: unknown): { id: string; displayName: string }[] {
    if (!phoneNetworks.has(network)) return [];
    const label = [roomName, channel?.displayname].find((value): value is string => Boolean(phoneLabel(value)));
    if (!label) return [];
    const server = this.mxid.split(':').slice(1).join(':');
    // The bridge names the chat after the person's own account (Signal's UUID): use it, so the
    // person is the same identity before and after they join (ADR 0035). Otherwise, the number.
    const account = typeof channel?.id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(channel.id) ? channel.id.toLowerCase() : phoneLabel(label);
    return [{ id: `@${bridgeNetworks[network].ghost}${account}:${server}`, displayName: label.trim() }];
  }

  private networkOfUser(userId: string): string | undefined {
    const local = userId.slice(1).split(':')[0] ?? '';
    return Object.entries(bridgeNetworks).find(([, network]) => local.startsWith(network.ghost) || local === network.bot)?.[0];
  }

  /** Discord's older bridge reports one login through its ping endpoint. */
  private async legacyLogins(network: string): Promise<{ id: string; name: string; state: string }[]> {
    const ping = await this.provision(network, 'GET', '/v1/ping') as { discord?: { id?: string; logged_in?: boolean; connected?: boolean } };
    if (!ping.discord?.logged_in) return [];
    return [{ id: ping.discord.id || 'discord', name: '', state: ping.discord.connected ? 'CONNECTED' : 'TRANSIENT_DISCONNECT' }];
  }

  private isBot(userId: string): boolean {
    const local = userId.slice(1).split(':')[0] ?? '';
    return Object.values(bridgeNetworks).some((network) => local === network.bot);
  }

  private async provision(network: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const config = bridgeNetworks[network];
    const base = config && this.env[config.url];
    if (!base) throw new UserFacingError('That network isn’t available on this server.');
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${base}/_matrix/provision${path}${separator}user_id=${encodeURIComponent(this.mxid)}`, {
      method,
      headers: { authorization: `Bearer ${this.env.BRIDGES_PROVISIONING_SECRET}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : method === 'POST' ? '{}' : undefined,
    });
    const result = await response.json().catch(() => ({})) as { error?: string; errcode?: string };
    if (!response.ok) throw new UserFacingError(bridgeError(config.name, result));
    return result;
  }

  private async matrix(method: string, path: string, body?: unknown): Promise<unknown> {
    const separator = path.includes('?') ? '&' : '?';
    const response = await fetch(`${this.env.BRIDGES_HOMESERVER_URL}${path}${separator}user_id=${encodeURIComponent(this.mxid)}`, {
      method,
      headers: { authorization: `Bearer ${this.env.BRIDGES_AS_TOKEN}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await response.json().catch(() => ({})) as { errcode?: string };
    if (!response.ok) {
      if (result.errcode === 'M_FORBIDDEN' || result.errcode === 'M_NOT_FOUND') throw new UserFacingError('Chat not found.');
      throw new UserFacingError('The chat bridge server isn’t answering. Try again soon.');
    }
    return result;
  }
}

type MatrixEvent = { type: string; state_key?: string; sender?: string; event_id?: string; origin_server_ts?: number; content?: Record<string, unknown> };
type JoinedRoom = { account_data?: { events?: MatrixEvent[] }; state?: { events?: MatrixEvent[] }; timeline?: { events?: MatrixEvent[] }; ephemeral?: { events?: MatrixEvent[] }; unread_notifications?: { notification_count?: number } };

// The stable name from Matrix 1.12 and the unstable one older clients still write.
const markedUnreadTypes = ['m.marked_unread', 'com.famedly.marked_unread'];

// Room version 12 ids are a bare hash (`!abc…`); older ones end in the server name (`!abc:server`).
const roomPattern = /^![A-Za-z0-9._=+/-]{1,255}(:[A-Za-z0-9.:-]+)?$/;

/**
 * Each member's latest read receipt in the main timeline: public `m.read`, plus your own private
 * `m.read.private` (the homeserver only ever shows you your own).
 */
function readReceipts(room: JoinedRoom): Map<string, { eventId: string; ts: number }> {
  const latest = new Map<string, { eventId: string; ts: number }>();
  for (const event of room.ephemeral?.events ?? []) {
    if (event.type !== 'm.receipt') continue;
    for (const [eventId, kinds] of Object.entries(event.content ?? {})) {
      for (const kind of ['m.read', 'm.read.private']) {
        const users = (kinds as Record<string, Record<string, { ts?: number; thread_id?: string }>> | undefined)?.[kind] ?? {};
        for (const [userId, receipt] of Object.entries(users)) {
          if (receipt?.thread_id && receipt.thread_id !== 'main') continue;
          const ts = typeof receipt?.ts === 'number' ? receipt.ts : 0;
          if ((latest.get(userId)?.ts ?? -1) < ts) latest.set(userId, { eventId, ts });
        }
      }
    }
  }
  return latest;
}

/** For someone who doesn't share read receipts: others' read times are hidden too (delivery stays). */
export function withoutReadTimes<T extends { rooms: BridgeRoomSnapshot[] }>(snapshot: T): T {
  return { ...snapshot, rooms: snapshot.rooms.map((room) => ({ ...room, events: room.events.map(({ readAt: _readAt, ...event }) => event) })) };
}
type SyncResponse = { rooms?: { join?: Record<string, JoinedRoom>; invite?: Record<string, { invite_state?: { events?: MatrixEvent[] } }> } };

export function networkOfProtocol(protocol: string | undefined): string | undefined {
  if (!protocol) return undefined;
  return Object.entries(bridgeNetworks).find(([id, network]) => id === protocol || network.protocols?.includes(protocol))?.[0];
}

/** Discord's sign-in token is sent as the Authorization header of its web app's requests. */
function legacyTokenStep(network: string): BridgeLoginStep {
  return {
    loginId: `${network}-token`,
    stepId: 'token',
    type: 'cookies',
    url: 'https://discord.com/app',
    instructions: 'Copy the Authorization request header from Discord’s web app.',
    fields: [{ id: 'token', name: 'Authorization', description: 'request header', type: 'cookie' }],
  };
}

/** Keeps only what the app needs from a bridge login step. */
export function toStep(raw: unknown): BridgeLoginStep {
  const step = raw as {
    login_id?: string; type?: string; step_id?: string; instructions?: string;
    display_and_wait?: { type?: string; data?: string };
    user_input?: { fields?: { id?: string; name?: string; description?: string; type?: string }[] };
    cookies?: { url?: string; fields?: { id?: string; sources?: { type?: string; name?: string; cookie_domain?: string }[] }[] };
  };
  const base = { loginId: String(step.login_id ?? ''), stepId: String(step.step_id ?? ''), instructions: step.instructions };
  if (step.type === 'display_and_wait') {
    const kind = step.display_and_wait?.type;
    return { ...base, type: 'display_and_wait', display: { type: kind === 'qr' || kind === 'code' || kind === 'emoji' ? kind : 'nothing', data: step.display_and_wait?.data } };
  }
  if (step.type === 'user_input') {
    return { ...base, type: 'user_input', fields: (step.user_input?.fields ?? []).map((field) => ({ id: String(field.id ?? ''), name: String(field.name ?? ''), description: field.description, type: String(field.type ?? 'text') })) };
  }
  if (step.type === 'cookies') {
    // Open Media can't read another site's cookies, so the person copies each value from their browser.
    return {
      ...base,
      type: 'cookies',
      url: step.cookies?.url,
      fields: (step.cookies?.fields ?? []).map((field) => {
        const source = field.sources?.find((item) => item.type === 'cookie') ?? field.sources?.[0];
        const where = source?.type === 'cookie' ? `cookie${source.cookie_domain ? ` on ${source.cookie_domain}` : ''}` : source?.type === 'local_storage' ? 'local storage' : source?.type === 'request_header' ? 'request header' : 'value';
        return { id: String(field.id ?? ''), name: String(source?.name ?? field.id ?? ''), description: where, type: 'cookie' };
      }),
    };
  }
  if (step.type === 'complete') return { ...base, type: 'complete' };
  return { ...base, type: 'unsupported', instructions: 'This network needs a sign-in step Open Media doesn’t support yet.' };
}

export function messageText(content: Record<string, unknown>): string {
  const body = typeof content.body === 'string' ? content.body : '';
  switch (content.msgtype) {
    case 'm.text': case 'm.notice': return body;
    case 'm.emote': return `* ${body}`;
    case 'm.image': return '📷 Photo';
    case 'm.video': return '🎥 Video';
    case 'm.audio': return '🎤 Voice message';
    case 'm.file': return `📎 ${body || 'File'}`;
    case 'm.location': return '📍 Location';
    default: return body;
  }
}

function stringValues(values: unknown): Record<string, string> {
  if (!values || typeof values !== 'object') throw new UserFacingError('Fill in the details first.');
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    if (!idPattern.test(key) || typeof value !== 'string' || value.length > 8192) throw new UserFacingError('Check the details and try again.');
    out[key] = value.trim();
  }
  return out;
}

function bridgeError(network: string, result: { error?: string; errcode?: string }): string {
  if (result.errcode === 'FI.MAU.NOT_LOGGED_IN') return `You’re not connected to ${network}.`;
  if (result.errcode === 'M_NOT_FOUND') return 'That connection attempt expired. Start again.';
  // Bridge messages describe login problems ("invalid phone number", "QR expired") and contain no secrets.
  return result.error ? `${network}: ${result.error}` : `${network} didn’t answer. Try again.`;
}
