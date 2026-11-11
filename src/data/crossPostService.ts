import AsyncStorage from '@react-native-async-storage/async-storage';

import { PublishedCopy, PublishingConnector, PublishingError } from '../connectors/publishing/types';
import { CrossPostOutcome, CrossPostPreferences, crossPostNetworks, CrossPostVideo, defaultCrossPostPreferences, DestinationId, destinationNames, prepareCrossPost } from '../domain/crossPosting';

const preferencesKey = 'open-media.cross-posting.preferences';
const ledgerKey = 'open-media.cross-posting.ledger';
const ledgerLimit = 300;

/**
 * The publishing client for a network. The clients carry signing code (curves, hashes, QR codes),
 * so they load on first use rather than with the app.
 */
export async function publishingConnector(network: DestinationId): Promise<PublishingConnector> {
  const { publishingConnectors } = await import('../connectors/publishing');
  return publishingConnectors.find((connector) => connector.id === network)!;
}

export async function loadCrossPostPreferences(): Promise<CrossPostPreferences> {
  try {
    const stored = JSON.parse((await AsyncStorage.getItem(preferencesKey)) ?? 'null') as Partial<CrossPostPreferences> | null;
    const excluded = Array.isArray(stored?.excludedByDefault) ? stored.excludedByDefault.filter((network): network is DestinationId => crossPostNetworks.includes(network as DestinationId)) : [];
    return { excludedByDefault: excluded };
  } catch {
    return defaultCrossPostPreferences;
  }
}

export async function saveCrossPostPreferences(preferences: CrossPostPreferences): Promise<void> {
  await AsyncStorage.setItem(preferencesKey, JSON.stringify(preferences));
}

/** Copies already published per post and network, so retrying never posts twice. */
type Ledger = Record<string, PublishedCopy & { at: number }>;

async function readLedger(): Promise<Ledger> {
  try { return JSON.parse((await AsyncStorage.getItem(ledgerKey)) ?? '{}') as Ledger; } catch { return {}; }
}

async function remember(key: string, copy: PublishedCopy) {
  const ledger = await readLedger();
  ledger[key] = { ...copy, at: Date.now() };
  const kept = Object.entries(ledger).sort(([, a], [, b]) => b.at - a.at).slice(0, ledgerLimit);
  await AsyncStorage.setItem(ledgerKey, JSON.stringify(Object.fromEntries(kept)));
}

/**
 * Publishes an already-saved Open Media post to each chosen network in parallel. `postId` is the
 * canonical Open Media post's client ID; with it, a retry skips networks that already have the post.
 * `video` is the post's video, already stored by Open Media (ADR 0009).
 */
export async function crossPost(body: string, destinations: DestinationId[], postId: string, video?: CrossPostVideo): Promise<CrossPostOutcome[]> {
  const ledger = await readLedger();
  return Promise.all(destinations.map(async (network): Promise<CrossPostOutcome> => {
    const key = `${postId}:${network}`;
    const existing = ledger[key];
    if (existing) return { network, status: 'published', url: existing.url, externalId: existing.externalId };
    const prepared = prepareCrossPost(body, network, video);
    if (!prepared.ok) return { network, status: 'skipped', message: prepared.reason };
    const connector = await publishingConnector(network);
    const availability = await connector.availability();
    if (!availability.available) return { network, status: 'skipped', message: availability.reason };
    try {
      if (!(await connector.account())) return { network, status: 'skipped', message: `Connect ${destinationNames[network]} in Settings → Cross-posting.` };
      const copy = await connector.publish(prepared.content, key);
      await remember(key, copy);
      return { network, status: 'published', url: copy.url, externalId: copy.externalId, message: prepared.note };
    } catch (error) {
      return { network, status: 'failed', message: error instanceof PublishingError ? error.message : `${destinationNames[network]} didn’t accept the post. Try again.` };
    }
  }));
}

// Which draft (client ID) each published post came from, so deleting the post finds its copies.
const postsKey = 'open-media.cross-posting.posts';

/** Remembers that the Open Media post `postId` was published from the draft `clientId`. */
export async function rememberPublishedPost(postId: string, clientId: string): Promise<void> {
  try {
    const posts = JSON.parse((await AsyncStorage.getItem(postsKey)) ?? '{}') as Record<string, string>;
    posts[postId] = clientId;
    const kept = Object.entries(posts).slice(-ledgerLimit);
    await AsyncStorage.setItem(postsKey, JSON.stringify(Object.fromEntries(kept)));
  } catch { /* Copies just won't be deleted with the post. */ }
}

/**
 * Deletes the copies this device published of a post, on networks that allow deleting (Farcaster's
 * CastRemove, ADR 0039). Returns the networks where a copy could not be deleted. Copies made on
 * another device, and on networks without deletion, stay where they are.
 */
export async function removeCrossPostCopies(postId: string): Promise<DestinationId[]> {
  let clientId: string | undefined;
  try { clientId = (JSON.parse((await AsyncStorage.getItem(postsKey)) ?? '{}') as Record<string, string>)[postId]; } catch { clientId = undefined; }
  if (!clientId) return [];
  const ledger = await readLedger();
  const copies = Object.entries(ledger).filter(([key]) => key.startsWith(`${clientId}:`));
  const failed: DestinationId[] = [];
  await Promise.all(copies.map(async ([key, copy]) => {
    const network = key.slice(clientId!.length + 1) as DestinationId;
    const connector = await publishingConnector(network);
    if (!connector.removeCopy) return;
    try {
      await connector.removeCopy(copy);
      delete ledger[key];
    } catch {
      failed.push(network);
    }
  }));
  await AsyncStorage.setItem(ledgerKey, JSON.stringify(ledger));
  return failed;
}
