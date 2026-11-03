import * as DocumentPicker from 'expo-document-picker';
import { Platform, Share } from 'react-native';

import { request } from '../connectors/mailApiConnector';
import { SocialPost } from '../domain/posts';
import { toOpml } from '../domain/webFeeds';
import { readFileText } from './profileImportFiles';

/**
 * Web feeds (ADR 0024). The Worker finds, reads and caches feeds; the app follows and unfollows
 * through it and shows the items. Nothing here talks to a publisher directly.
 */

export interface WebFeedSubscription { id: string; url: string; title: string; siteUrl: string | null; iconUrl: string | null; official: { name: string; domain: string } | null; addedAt: string }

export interface WebFeedPreview {
  feedUrl: string; title: string; siteUrl: string | null; iconUrl: string | null; format: string;
  official: { name: string; domain: string } | null; readEveryMinutes: number;
  items: { title: string; url: string | null; publishedAt: string | null; excerpt: string }[];
}

export interface WebFeedItems { posts: SocialPost[]; feeds: { url: string; title: string; status: number; error: string | null; gone: boolean }[] }

const listeners = new Set<() => void>();

/** Called whenever the person follows, unfollows or imports feeds, so the Feed reloads them. */
export function onWebFeedsChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
const changed = () => listeners.forEach((listener) => listener());

export async function listWebFeeds(): Promise<WebFeedSubscription[]> {
  return (await request<{ feeds: WebFeedSubscription[] }>('/v1/me/web-feeds', {}, 'Couldn’t load your web feeds.')).feeds;
}

export function previewWebFeed(url: string, signal?: AbortSignal): Promise<WebFeedPreview> {
  return request<WebFeedPreview>(`/v1/web-feeds/preview?url=${encodeURIComponent(url)}`, { signal }, 'That feed couldn’t be read.');
}

export async function followWebFeed(url: string): Promise<WebFeedSubscription> {
  const result = await request<{ followed: WebFeedSubscription }>('/v1/me/web-feeds', { method: 'POST', body: { url } }, 'That feed couldn’t be followed.');
  changed();
  return result.followed;
}

export async function unfollowWebFeed(feed: string): Promise<WebFeedSubscription[]> {
  const result = await request<{ unfollowed: WebFeedSubscription[] }>(`/v1/me/web-feeds?feed=${encodeURIComponent(feed)}`, { method: 'DELETE' }, 'That feed couldn’t be unfollowed.');
  changed();
  return result.unfollowed;
}

export function loadWebFeedItems(): Promise<WebFeedItems> {
  return request<WebFeedItems>('/v1/me/web-feeds/items', {}, 'Couldn’t load your web feeds.');
}

/** Lets the person pick an OPML file from another reader and follows its feeds. Undefined when they close the picker. */
export async function importOpmlFile(): Promise<{ added: number; skipped: { url: string; reason: string }[] } | undefined> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['text/x-opml', 'application/xml', 'text/xml', '*/*'], multiple: false, copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return undefined;
  const asset = picked.assets[0];
  if ((asset.size ?? 0) > 2_000_000) throw new Error('That file is larger than 2 MB. OPML exports are usually much smaller.');
  const opml = await readFileText({ name: asset.name, uri: asset.uri, mimeType: asset.mimeType, size: asset.size, file: asset.file });
  const result = await request<{ added: number; skipped: { url: string; reason: string }[] }>('/v1/me/web-feeds/opml', { method: 'POST', body: { opml } }, 'That OPML file couldn’t be read.');
  changed();
  return result;
}

/** Saves the person's feeds as an OPML file (a download on the web, the share sheet on phones). */
export async function exportOpml(): Promise<number> {
  const feeds = await listWebFeeds();
  const opml = toOpml(feeds.map((feed) => ({ url: feed.url, title: feed.title, ...(feed.siteUrl ? { siteUrl: feed.siteUrl } : {}) })));
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([opml], { type: 'text/x-opml' }));
    link.download = 'open-media-feeds.opml';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  } else {
    await Share.share({ title: 'open-media-feeds.opml', message: opml });
  }
  return feeds.length;
}
