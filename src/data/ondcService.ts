import { request } from '../connectors/mailApiConnector';
import { OndcStore } from '../domain/ondc';

/** The person's ONDC store through the Open Media service (ADR 0015). */
export type SavedOndcStore = OndcStore & { id: string; offeredItems?: number };

export async function loadOndcStore(): Promise<SavedOndcStore | null> {
  return (await request<{ store: SavedOndcStore | null }>('/v1/me/ondc', {}, 'Could not load your ONDC store.')).store;
}

export async function saveOndcStore(store: OndcStore): Promise<SavedOndcStore> {
  return (await request<{ store: SavedOndcStore }>('/v1/me/ondc', { method: 'PUT', body: store }, 'Your ONDC store could not be saved.')).store;
}
