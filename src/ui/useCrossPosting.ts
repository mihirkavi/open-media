import { useCallback, useEffect, useSyncExternalStore } from 'react';

import { ApprovalPrompt, NetworkAccount, PublishAvailability } from '../connectors/publishing/types';
import { loadCrossPostPreferences, publishingConnector, saveCrossPostPreferences } from '../data/crossPostService';
import { CrossPostPreferences, crossPostNetworks, defaultCrossPostPreferences, defaultDestinations } from '../domain/crossPosting';
import { NetworkId } from '../domain/networkPosts';

export interface CrossPostNetworkState {
  network: NetworkId;
  availability: PublishAvailability;
  account?: NetworkAccount;
  busy: boolean;
  error: string;
  /** An approval step to finish outside Open Media (for example a QR code for Farcaster). */
  approval?: ApprovalPrompt;
}

interface Snapshot { loaded: boolean; preferences: CrossPostPreferences; networks: CrossPostNetworkState[] }

// One shared store, so the composer and Settings always agree on what is connected.
let snapshot: Snapshot = {
  loaded: false,
  preferences: defaultCrossPostPreferences,
  networks: crossPostNetworks.map((network) => ({ network, availability: { available: true }, busy: false, error: '' })),
};
const listeners = new Set<() => void>();
let loading: Promise<void> | undefined;
const pendingConnections = new Map<NetworkId, AbortController>();

function update(change: (current: Snapshot) => Snapshot) {
  snapshot = change(snapshot);
  listeners.forEach((listener) => listener());
}

function updateNetwork(network: NetworkId, change: Partial<CrossPostNetworkState>) {
  update((current) => ({ ...current, networks: current.networks.map((item) => item.network === network ? { ...item, ...change } : item) }));
}

function load() {
  loading ??= (async () => {
    const preferences = await loadCrossPostPreferences();
    const networks = await Promise.all(crossPostNetworks.map(async (network): Promise<CrossPostNetworkState> => {
      const connector = publishingConnector(network);
      const availability = await connector.availability().catch((): PublishAvailability => ({ available: false, setup: 'owner', reason: 'Not available right now.' }));
      const account = availability.available ? await connector.account().catch(() => undefined) : undefined;
      return { network, availability, account, busy: false, error: '' };
    }));
    update(() => ({ loaded: true, preferences, networks }));
  })();
  return loading;
}

export function useCrossPosting() {
  const state = useSyncExternalStore((listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot, () => snapshot);
  useEffect(() => { load(); }, []);

  const connect = useCallback(async (network: NetworkId) => {
    pendingConnections.get(network)?.abort();
    const controller = new AbortController();
    pendingConnections.set(network, controller);
    updateNetwork(network, { busy: true, error: '', approval: undefined });
    try {
      const account = await publishingConnector(network).connect({ signal: controller.signal, showApproval: (approval) => updateNetwork(network, { approval }) });
      updateNetwork(network, { account, busy: false, approval: undefined });
    } catch (error) {
      updateNetwork(network, { busy: false, approval: undefined, error: controller.signal.aborted ? '' : error instanceof Error ? error.message : 'Connecting didn’t finish. Try again.' });
    } finally {
      if (pendingConnections.get(network) === controller) pendingConnections.delete(network);
    }
  }, []);

  const cancelConnect = useCallback((network: NetworkId) => { pendingConnections.get(network)?.abort(); }, []);

  const disconnect = useCallback(async (network: NetworkId) => {
    updateNetwork(network, { busy: true, error: '' });
    try {
      await publishingConnector(network).disconnect();
      updateNetwork(network, { account: undefined, busy: false });
    } catch (error) {
      updateNetwork(network, { busy: false, error: error instanceof Error ? error.message : 'Disconnecting failed. Try again.' });
    }
  }, []);

  const setIncludedByDefault = useCallback(async (network: NetworkId, included: boolean) => {
    const excluded = new Set(snapshot.preferences.excludedByDefault);
    if (included) excluded.delete(network); else excluded.add(network);
    const preferences = { excludedByDefault: crossPostNetworks.filter((item) => excluded.has(item)) };
    update((current) => ({ ...current, preferences }));
    await saveCrossPostPreferences(preferences);
  }, []);

  const connected = state.networks.filter((item) => item.account).map((item) => item.network);
  return {
    loaded: state.loaded,
    networks: state.networks,
    preferences: state.preferences,
    connected,
    defaults: defaultDestinations(connected, state.preferences),
    connect,
    cancelConnect,
    disconnect,
    setIncludedByDefault,
  };
}
