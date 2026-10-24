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
}

type NetworkConfig = { name: string; url: keyof BridgesEnv; ghost: string; bot: string };

/** Networks Open Media can bridge. Only those with a configured bridge URL are offered. */
export const bridgeNetworks: Record<string, NetworkConfig> = {
  whatsapp: { name: 'WhatsApp', url: 'BRIDGES_WHATSAPP_URL', ghost: 'whatsapp_', bot: 'whatsappbot' },
  telegram: { name: 'Telegram', url: 'BRIDGES_TELEGRAM_URL', ghost: 'telegram_', bot: 'telegrambot' },
  signal: { name: 'Signal', url: 'BRIDGES_SIGNAL_URL', ghost: 'signal_', bot: 'signalbot' },
  gmessages: { name: 'Google Messages', url: 'BRIDGES_GMESSAGES_URL', ghost: 'gmessages_', bot: 'gmessagesbot' },
  instagram: { name: 'Instagram', url: 'BRIDGES_INSTAGRAM_URL', ghost: 'instagram_', bot: 'instagrambot' },
  messenger: { name: 'Messenger', url: 'BRIDGES_MESSENGER_URL', ghost: 'messenger_', bot: 'messengerbot' },
  linkedin: { name: 'LinkedIn', url: 'BRIDGES_LINKEDIN_URL', ghost: 'linkedin_', bot: 'linkedinbot' },
  twitter: { name: 'X', url: 'BRIDGES_TWITTER_URL', ghost: 'twitter_', bot: 'twitterbot' },
  bluesky: { name: 'Bluesky', url: 'BRIDGES_BLUESKY_URL', ghost: 'bluesky_', bot: 'blueskybot' },
  slack: { name: 'Slack', url: 'BRIDGES_SLACK_URL', ghost: 'slack_', bot: 'slackbot' },
  discord: { name: 'Discord', url: 'BRIDGES_DISCORD_URL', ghost: 'discord_', bot: 'discordbot' },
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
  members: { id: string; displayName: string }[];
  events: { id: string; sender: string; body: string; timestamp: number }[];
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

export class Bridges {
  private readonly mxid: string;

  constructor(private readonly env: BridgesEnv, userId: string) {
    if (!bridgesConfigured(env)) throw new UserFacingError('Bridged chats aren’t set up on this server yet.');
    this.mxid = matrixUserFor(userId, env);
  }

  /** Creates this person's Matrix user the first time it's needed. */
  async ensureUser(): Promise<void> {
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
    const result = await this.provision(network, 'GET', '/v3/login/flows') as { flows?: { id?: string; name?: string; description?: string }[] };
    return (result.flows ?? []).map((flow) => ({ id: String(flow.id ?? ''), name: String(flow.name ?? ''), description: String(flow.description ?? '') })).filter((flow) => idPattern.test(flow.id));
  }

  async startLogin(network: string, flow: unknown): Promise<BridgeLoginStep> {
    if (typeof flow !== 'string' || !idPattern.test(flow)) throw new UserFacingError('Choose how to connect.');
    await this.ensureUser();
    return toStep(await this.provision(network, 'POST', `/v3/login/start/${encodeURIComponent(flow)}`));
  }

  async continueLogin(network: string, input: { loginId?: unknown; stepId?: unknown; type?: unknown; values?: unknown }): Promise<BridgeLoginStep> {
    const { loginId, stepId, type, values } = input;
    if (typeof loginId !== 'string' || !idPattern.test(loginId) || typeof stepId !== 'string' || !idPattern.test(stepId)) throw new UserFacingError('That connection attempt expired. Start again.');
    if (type !== 'display_and_wait' && type !== 'user_input' && type !== 'cookies') throw new UserFacingError('That connection step isn’t supported.');
    const body = type === 'display_and_wait' ? undefined : stringValues(values);
    return toStep(await this.provision(network, 'POST', `/v3/login/step/${encodeURIComponent(loginId)}/${encodeURIComponent(stepId)}/${type}`, body));
  }

  async cancelLogin(network: string, loginId: unknown): Promise<void> {
    if (typeof loginId !== 'string' || !idPattern.test(loginId)) return;
    await this.provision(network, 'POST', `/v3/login/cancel/${encodeURIComponent(loginId)}`).catch(() => undefined);
  }

  async logout(network: string, loginId: unknown): Promise<void> {
    const id = loginId === undefined ? 'all' : loginId;
    if (typeof id !== 'string' || !idPattern.test(id)) throw new UserFacingError('Account not found.');
    await this.provision(network, 'POST', `/v3/logout/${encodeURIComponent(id)}`);
  }

  /** Recent bridged chats for this person, newest messages included. */
  async conversations(): Promise<{ userId: string; rooms: BridgeRoomSnapshot[] }> {
    await this.ensureUser();
    const filter = {
      presence: { not_types: ['*'] },
      account_data: { not_types: ['*'] },
      room: { timeline: { limit: 30 }, ephemeral: { not_types: ['*'] }, account_data: { not_types: ['*'] } },
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

  async send(roomId: string, body: unknown): Promise<void> {
    if (!/^![A-Za-z0-9._=-]+:[A-Za-z0-9.:-]+$/.test(roomId)) throw new UserFacingError('Chat not found.');
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
    const network = (bridgeInfo?.content?.protocol as { id?: string } | undefined)?.id ?? others.map(([id]) => this.networkOfUser(id)).find(Boolean);
    // Management rooms (only the bridge bot) and non-bridged rooms aren't chats.
    if (!network || !bridgeNetworks[network] || others.length === 0) return null;
    const name = typeof state.findLast((event) => event.type === 'm.room.name')?.content?.name === 'string'
      ? String(state.findLast((event) => event.type === 'm.room.name')?.content?.name)
      : others.map(([, displayName]) => displayName).join(', ');
    const events = (room.timeline?.events ?? [])
      .filter((event) => event.type === 'm.room.message' && event.event_id && event.sender)
      .map((event) => ({ id: event.event_id!, sender: event.sender!, body: messageText(event.content ?? {}), timestamp: event.origin_server_ts ?? 0 }))
      .filter((event) => event.body);
    return { id: roomId, network, name, members: others.map(([id, displayName]) => ({ id, displayName })), events };
  }

  private networkOfUser(userId: string): string | undefined {
    const local = userId.slice(1).split(':')[0] ?? '';
    return Object.entries(bridgeNetworks).find(([, network]) => local.startsWith(network.ghost) || local === network.bot)?.[0];
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
type JoinedRoom = { state?: { events?: MatrixEvent[] }; timeline?: { events?: MatrixEvent[] } };
type SyncResponse = { rooms?: { join?: Record<string, JoinedRoom>; invite?: Record<string, { invite_state?: { events?: MatrixEvent[] } }> } };

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
