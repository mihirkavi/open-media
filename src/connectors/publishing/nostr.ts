import { getRandomValues } from 'expo-crypto';
import QRCode from 'qrcode';
import { Platform } from 'react-native';

import { deviceSecretStorage } from '../../auth/supabase';
import { bech32Encode, fromHexString, NostrEvent, nostrProfileFromEvent, nostrTags, toHexString } from '../../domain/openNetworkPosts';
import { nostrPublicKeyFor, signNostrEvent, UnsignedNostrEvent, verifyNostrEvent } from '../nostrEvent';
import { defaultNostrRelays, publishNostr, queryNostr, subscribeNostr } from '../nostrRelays';
import { conversationKey, nip44Decrypt, nip44Encrypt } from './nip44';
import { NetworkAccount, PublishingConnector, PublishingError } from './types';

/**
 * Nostr (ADR 0033). Open Media never sees the person's Nostr secret key (nsec). Notes are signed by:
 * - a browser signer extension (NIP-07, for example Alby or nos2x) on web when one is installed, or
 * - a remote signer app (NIP-46 “Nostr Connect”: Amber, Primal, nsec.app and others): the person
 *   scans a code or taps a link, approves Open Media there, and can revoke it there at any time.
 *   Open Media keeps only a random connection key for talking to that signer.
 */
const storageKey = 'open-media.network.nostr';
const signerRelays = ['wss://relay.nsec.app', 'wss://relay.damus.io', 'wss://nos.lol'];
const approvalTimeoutMs = 10 * 60_000;
const requestTimeoutMs = 90_000;

type StoredNostr =
  | { mode: 'extension'; pubkey: string; name?: string }
  | { mode: 'remote'; pubkey: string; name?: string; clientSecret: string; signer: string; relays: string[] };

interface NostrExtension { getPublicKey(): Promise<string>; signEvent(event: UnsignedNostrEvent & { pubkey?: string }): Promise<NostrEvent> }

function extension(): NostrExtension | undefined {
  return Platform.OS === 'web' && typeof window !== 'undefined' ? (window as unknown as { nostr?: NostrExtension }).nostr : undefined;
}

async function load(): Promise<StoredNostr | undefined> {
  try {
    const stored = JSON.parse((await deviceSecretStorage().getItem(storageKey)) ?? 'null') as StoredNostr | null;
    return stored && /^[0-9a-f]{64}$/.test(stored.pubkey) ? stored : undefined;
  } catch { return undefined; }
}

function toAccount(stored: StoredNostr): NetworkAccount {
  const npub = bech32Encode('npub', fromHexString(stored.pubkey));
  return { network: 'nostr', handle: stored.name ? `@${stored.name}` : `${npub.slice(0, 14)}…`, profileURL: `https://njump.me/${npub}` };
}

async function profileName(pubkey: string): Promise<string | undefined> {
  const events = await queryNostr({ kinds: [0], authors: [pubkey], limit: 3 }, undefined, 4000).catch(() => []);
  const profile = nostrProfileFromEvent(events.find(verifyNostrEvent));
  return (profile?.name || profile?.display_name)?.replace(/\s+/g, '').slice(0, 40) || undefined;
}

// ---------- NIP-46 remote signer ----------

function randomHex(bytes: number) { return toHexString(getRandomValues(new Uint8Array(bytes))); }

async function sendToSigner(stored: Extract<StoredNostr, { mode: 'remote' }>, method: string, params: string[], onAuthURL?: (url: string) => void): Promise<string> {
  const secret = fromHexString(stored.clientSecret);
  const clientPubkey = nostrPublicKeyFor(secret);
  const key = conversationKey(secret, stored.signer);
  const id = randomHex(8);
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { close(); reject(new PublishingError('Your Nostr signer didn’t answer. Open it and try again.')); }, requestTimeoutMs);
    const close = subscribeNostr({ kinds: [24133], '#p': [clientPubkey], since: Math.floor(Date.now() / 1000) - 10 }, (event) => {
      if (event.pubkey !== stored.signer || !verifyNostrEvent(event)) return;
      try {
        const response = JSON.parse(nip44Decrypt(event.content, key)) as { id?: string; result?: string; error?: string };
        if (response.id !== id) return;
        if (response.result === 'auth_url' && response.error) { onAuthURL?.(response.error); return; }
        clearTimeout(timer); close();
        if (response.error) reject(new PublishingError(`Your Nostr signer said: ${response.error.slice(0, 140)}`));
        else resolve(response.result ?? '');
      } catch { /* not for this request */ }
    }, stored.relays);
    const request = signNostrEvent({ pubkey: clientPubkey, created_at: Math.floor(Date.now() / 1000), kind: 24133, tags: [['p', stored.signer]], content: nip44Encrypt(JSON.stringify({ id, method, params }), key, getRandomValues(new Uint8Array(32))) }, secret);
    // Give the subscription a moment to open before the request goes out.
    setTimeout(() => { publishNostr(request, stored.relays).catch(() => undefined); }, 600);
  });
}

async function connectRemote(showApproval: Parameters<PublishingConnector['connect']>[0]['showApproval'], signal: AbortSignal): Promise<StoredNostr> {
  const clientSecret = getRandomValues(new Uint8Array(32));
  const clientPubkey = nostrPublicKeyFor(clientSecret);
  const secret = randomHex(8);
  const query = new URLSearchParams({ secret, name: 'Open Media', url: 'https://openmedia.site', perms: 'sign_event:1,sign_event:6,sign_event:7,get_public_key' });
  const uri = `nostrconnect://${clientPubkey}?${signerRelays.map((relay) => `relay=${encodeURIComponent(relay)}`).join('&')}&${query}`;
  const qrCode = `data:image/svg+xml;utf8,${encodeURIComponent(await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }))}`;
  showApproval({ title: 'Approve Open Media in your Nostr signer', message: 'Scan this code with a Nostr signer app such as Amber, Primal or nsec.app, or open it on this device, then approve Open Media. Your secret key stays in the signer.', url: uri, qrCode });
  const signer = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { close(); reject(new PublishingError('The approval timed out. Try again.')); }, approvalTimeoutMs);
    signal.addEventListener('abort', () => { clearTimeout(timer); close(); reject(new PublishingError('Connecting was cancelled.')); }, { once: true });
    const close = subscribeNostr({ kinds: [24133], '#p': [clientPubkey], since: Math.floor(Date.now() / 1000) - 10 }, (event) => {
      if (!verifyNostrEvent(event)) return;
      try {
        const response = JSON.parse(nip44Decrypt(event.content, conversationKey(clientSecret, event.pubkey))) as { result?: string };
        if (response.result === secret || response.result === 'ack') { clearTimeout(timer); close(); resolve(event.pubkey); }
      } catch { /* someone else's message */ }
    }, signerRelays);
  });
  showApproval(undefined);
  const partial = { mode: 'remote' as const, pubkey: signer, clientSecret: toHexString(clientSecret), signer, relays: signerRelays };
  // The signer's own key may differ from the person's account key; ask for the account key.
  const pubkey = await sendToSigner(partial, 'get_public_key', []).catch(() => signer);
  return { ...partial, pubkey: /^[0-9a-f]{64}$/.test(pubkey) ? pubkey : signer };
}

async function sign(stored: StoredNostr, event: Omit<UnsignedNostrEvent, 'pubkey'>): Promise<NostrEvent> {
  const unsigned = { ...event, pubkey: stored.pubkey };
  let signed: NostrEvent;
  if (stored.mode === 'extension') {
    const signer = extension();
    if (!signer) throw new PublishingError('Your Nostr browser extension isn’t available in this browser. Connect Nostr again in Settings → Cross-posting.');
    signed = await signer.signEvent(unsigned);
  } else {
    signed = JSON.parse(await sendToSigner(stored, 'sign_event', [JSON.stringify(unsigned)])) as NostrEvent;
  }
  if (!verifyNostrEvent(signed) || signed.pubkey !== stored.pubkey) throw new PublishingError('The Nostr signer returned a note Open Media couldn’t verify.');
  return signed;
}

async function signAndPublish(event: Omit<UnsignedNostrEvent, 'pubkey'>) {
  const stored = await load();
  if (!stored) throw new PublishingError('Connect Nostr in Settings → Cross-posting.');
  const signed = await sign(stored, event);
  const accepted = await publishNostr(signed);
  if (!accepted.length) throw new PublishingError('No Nostr relay accepted the note. Try again.');
  return signed;
}

const now = () => Math.floor(Date.now() / 1000);

export const nostrPublisher: PublishingConnector = {
  id: 'nostr',
  revokeHint: 'Open Media never holds your Nostr secret key. To revoke it, remove Open Media from your signer app or browser extension.',

  async availability() { return { available: true }; },

  async account() {
    const stored = await load();
    return stored ? toAccount(stored) : undefined;
  },

  async connect({ showApproval, signal }) {
    const browserSigner = extension();
    let stored: StoredNostr;
    if (browserSigner) {
      const pubkey = (await browserSigner.getPublicKey()).toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(pubkey)) throw new PublishingError('The Nostr extension didn’t share a public key.');
      stored = { mode: 'extension', pubkey };
    } else {
      stored = await connectRemote(showApproval, signal);
    }
    stored = { ...stored, name: await profileName(stored.pubkey) };
    await deviceSecretStorage().setItem(storageKey, JSON.stringify(stored));
    return toAccount(stored);
  },

  async disconnect() {
    await deviceSecretStorage().removeItem(storageKey);
  },

  async publish(content) {
    const signed = await signAndPublish({ kind: 1, created_at: now(), tags: nostrTags(content.text), content: content.text });
    return { externalId: `${signed.id} ${signed.pubkey}`, url: `https://njump.me/${bech32Encode('note', fromHexString(signed.id))}` };
  },

  async interact(target, interaction) {
    if (target.network !== 'nostr') throw new PublishingError('That note isn’t on Nostr.');
    const relay = defaultNostrRelays[0];
    if (interaction.kind === 'comment') {
      const signed = await signAndPublish({ kind: 1, created_at: now(), tags: [['e', target.id, relay, 'root'], ['p', target.pubkey], ...nostrTags(interaction.text)], content: interaction.text });
      return { externalId: `${signed.id} ${signed.pubkey}`, url: `https://njump.me/${bech32Encode('note', fromHexString(signed.id))}` };
    }
    if (interaction.kind === 'like') await signAndPublish({ kind: 7, created_at: now(), tags: [['e', target.id, relay], ['p', target.pubkey]], content: '+' });
    else await signAndPublish({ kind: 6, created_at: now(), tags: [['e', target.id, relay], ['p', target.pubkey]], content: '' });
    return undefined;
  },
};
