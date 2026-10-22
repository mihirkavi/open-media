import AsyncStorage from '@react-native-async-storage/async-storage';

import { publishingConnectors } from '../connectors/publishing';
import { PublishedCopy, PublishingConnector, PublishingError } from '../connectors/publishing/types';
import { CrossPostOutcome, CrossPostPreferences, crossPostNetworks, CrossPostVideo, defaultCrossPostPreferences, prepareCrossPost } from '../domain/crossPosting';
import { NetworkId, networks } from '../domain/networkPosts';

const preferencesKey = 'open-media.cross-posting.preferences';
const ledgerKey = 'open-media.cross-posting.ledger';
const ledgerLimit = 300;

export function publishingConnector(network: NetworkId): PublishingConnector {
  return publishingConnectors.find((connector) => connector.id === network)!;
}

export async function loadCrossPostPreferences(): Promise<CrossPostPreferences> {
  try {
    const stored = JSON.parse((await AsyncStorage.getItem(preferencesKey)) ?? 'null') as Partial<CrossPostPreferences> | null;
    const excluded = Array.isArray(stored?.excludedByDefault) ? stored.excludedByDefault.filter((network): network is NetworkId => crossPostNetworks.includes(network as NetworkId)) : [];
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
export async function crossPost(body: string, destinations: NetworkId[], postId: string, video?: CrossPostVideo): Promise<CrossPostOutcome[]> {
  const ledger = await readLedger();
  return Promise.all(destinations.map(async (network): Promise<CrossPostOutcome> => {
    const key = `${postId}:${network}`;
    const existing = ledger[key];
    if (existing) return { network, status: 'published', url: existing.url, externalId: existing.externalId };
    const prepared = prepareCrossPost(body, network, video);
    if (!prepared.ok) return { network, status: 'skipped', message: prepared.reason };
    const connector = publishingConnector(network);
    const availability = await connector.availability();
    if (!availability.available) return { network, status: 'skipped', message: availability.reason };
    try {
      if (!(await connector.account())) return { network, status: 'skipped', message: `Connect ${networks[network].displayName} in Settings → Cross-posting.` };
      const copy = await connector.publish(prepared.content, key);
      await remember(key, copy);
      return { network, status: 'published', url: copy.url, externalId: copy.externalId, message: prepared.note };
    } catch (error) {
      return { network, status: 'failed', message: error instanceof PublishingError ? error.message : `${networks[network].displayName} didn’t accept the post. Try again.` };
    }
  }));
}
