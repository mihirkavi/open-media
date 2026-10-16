/**
 * Attachments and images from a parsed email.
 *
 * - Files (and embedded cid: images) are kept for upload to private Storage,
 *   up to 10 per message and 15 MB each; larger files keep metadata only.
 * - Remote <img> URLs in HTML are kept as URLs (HTTPS only, at most 8); the app
 *   loads them only when the person taps "Show images". Tracking pixels (tiny
 *   or hidden images, typical open-tracking paths) are dropped.
 */
import { createHash } from 'node:crypto';

import { MailAttachment } from './types.js';

export const maxAttachmentsPerMessage = 10;
export const maxAttachmentBytes = 15 * 1024 * 1024;

interface ParsedAttachment {
  filename?: string;
  contentType?: string;
  size?: number;
  content?: Buffer | Uint8Array;
  contentDisposition?: string;
  related?: boolean;
}

export function collectAttachments(attachments: ParsedAttachment[] | undefined): MailAttachment[] {
  return (attachments ?? [])
    .filter((attachment) => attachment.contentType !== 'text/calendar' || attachment.filename)
    .slice(0, maxAttachmentsPerMessage)
    .map((attachment, index) => {
      const content = attachment.content ? Buffer.from(attachment.content) : undefined;
      const size = attachment.size ?? content?.byteLength ?? 0;
      return {
        filename: safeFilename(attachment.filename, attachment.contentType, index),
        contentType: (attachment.contentType ?? 'application/octet-stream').toLowerCase().slice(0, 255),
        size,
        inline: attachment.contentDisposition === 'inline' || Boolean(attachment.related),
        content: content && size <= maxAttachmentBytes ? content : undefined,
      };
    });
}

export function collectRemoteImages(html: string | false | undefined): string[] {
  if (!html) return [];
  const images: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = attribute(tag, 'src');
    if (!src || !/^https:\/\//i.test(src)) continue;
    const width = Number(attribute(tag, 'width') ?? NaN);
    const height = Number(attribute(tag, 'height') ?? NaN);
    const style = (attribute(tag, 'style') ?? '').toLowerCase();
    if ((width && width <= 3) || (height && height <= 3)) continue;
    if (/display\s*:\s*none|visibility\s*:\s*hidden|width\s*:\s*[0-3]px|height\s*:\s*[0-3]px/.test(style)) continue;
    if (/\/(open|track|pixel|beacon|wf\/open|e\/o)\b|[?&](open|pixel)=|\.gif\?/i.test(src)) continue;
    const url = src.replace(/&amp;/g, '&');
    if (!images.includes(url)) images.push(url);
    if (images.length >= 8) break;
  }
  return images;
}

/** Storage path inside the person's own folder; stable so re-syncs overwrite rather than duplicate. */
export function attachmentPath(userId: string, accountId: string, sourceMessageId: string, position: number, filename: string): string {
  const messageKey = createHash('sha256').update(sourceMessageId).digest('hex').slice(0, 32);
  return `${userId}/${accountId}/${messageKey}/${position}-${filename}`;
}

function safeFilename(name: string | undefined, contentType: string | undefined, index: number): string {
  const cleaned = (name ?? '').normalize('NFC').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120);
  if (cleaned) return cleaned;
  const extension = (contentType ?? '').split('/')[1]?.split(/[;+]/)[0];
  return `attachment-${index + 1}${extension ? `.${extension}` : ''}`;
}

function attribute(tag: string, name: string): string | undefined {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return match ? (match[2] ?? match[3] ?? match[4]) : undefined;
}
