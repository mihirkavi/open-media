/**
 * Farcaster cast text and structure (ADR 0039). Farcaster does not keep "@name" in a cast's text:
 * it keeps the mentioned accounts (fids) and the UTF-8 byte offsets where each name goes, so every
 * app shows the person's current username. These pure helpers turn that into readable text and
 * back, and describe a cast's quote, channel and size.
 */

/** A cast as Snapchain's HTTP API returns its body. */
export interface FarcasterCastBody {
  text?: string;
  mentions?: number[];
  mentionsPositions?: number[];
  parentUrl?: string | null;
  parentCastId?: { fid?: number; hash?: string } | null;
  embeds?: { url?: string; castId?: { fid?: number; hash?: string } }[];
  type?: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The cast's text with each mention put back as "@username" at its byte offset. A mention whose
 * account has no username yet reads "@fid:123", so the sentence never has a silent gap.
 */
export function textWithMentions(body: FarcasterCastBody, usernames: ReadonlyMap<number, string | undefined>): string {
  const text = body.text ?? '';
  const mentions = body.mentions ?? [];
  const positions = body.mentionsPositions ?? [];
  if (!mentions.length || mentions.length !== positions.length) return text;
  const bytes = encoder.encode(text);
  const order = mentions.map((fid, index) => ({ fid, at: positions[index] })).filter((item) => Number.isInteger(item.at) && item.at >= 0 && item.at <= bytes.length).sort((a, b) => a.at - b.at);
  let out = '';
  let from = 0;
  for (const { fid, at } of order) {
    out += decoder.decode(bytes.slice(from, at));
    out += `@${usernames.get(fid) ?? `fid:${fid}`}`;
    from = at;
  }
  return out + decoder.decode(bytes.slice(from));
}

/** A cast that quotes another: the quoted cast's id, from a `castId` embed. */
export function quotedCast(body: FarcasterCastBody): { fid: number; hash: `0x${string}` } | undefined {
  const embed = (body.embeds ?? []).find((item) => item.castId);
  const fid = embed?.castId?.fid;
  const hash = embed?.castId?.hash?.toLowerCase();
  return Number.isSafeInteger(fid) && fid! > 0 && hash && /^0x[0-9a-f]{40}$/.test(hash) ? { fid: fid!, hash: hash as `0x${string}` } : undefined;
}

/** Every account a cast mentions, once each, so their names can be read before it is shown. */
export function mentionedFids(bodies: (FarcasterCastBody | undefined)[]): number[] {
  return [...new Set(bodies.flatMap((body) => body?.mentions ?? []).filter((fid) => Number.isSafeInteger(fid) && fid > 0))];
}

/** Farcaster allows at most 10 mentions in one cast. */
export const maxCastMentions = 10;

// "@name" or "@name.eth", not inside an email address or another word.
const mentionPattern = /(^|[^\p{L}\p{N}_@.])@([a-z0-9][a-z0-9-]{0,15}(?:\.eth)?)(?![\p{L}\p{N}_-])/giu;

/** The "@names" in text that could be Farcaster usernames, lower-cased, once each, in order. */
export function mentionCandidates(text: string): string[] {
  return [...new Set([...text.matchAll(mentionPattern)].map((match) => match[2].toLowerCase()))];
}

/**
 * Text as Farcaster sends it (ADR 0039): each "@name" that `fids` resolves is taken out of the text
 * and becomes a mention at that byte offset, so Farcaster notifies the person and every app shows
 * their current name. Names that don't resolve, and any past the tenth mention, stay as plain text.
 */
export function castWithMentions(text: string, fids: ReadonlyMap<string, number>): { text: string; mentions: { fid: number; at: number }[] } {
  const mentions: { fid: number; at: number }[] = [];
  let out = '';
  let from = 0;
  for (const match of text.matchAll(mentionPattern)) {
    const fid = fids.get(match[2].toLowerCase());
    if (!fid || mentions.length >= maxCastMentions) continue;
    const start = match.index! + match[1].length;
    out += text.slice(from, start);
    mentions.push({ fid, at: encoder.encode(out).length });
    from = start + 1 + match[2].length;
  }
  return { text: out + text.slice(from), mentions };
}

/** "1,000+ followers · 79 following", in the viewer's number format. */
export function followCountsLine(counts: { followers: number; following: number; moreFollowers: boolean; moreFollowing: boolean }): string {
  const number = (value: number, more: boolean) => `${value.toLocaleString()}${more ? '+' : ''}`;
  return `${number(counts.followers, counts.moreFollowers)} ${counts.followers === 1 && !counts.moreFollowers ? 'follower' : 'followers'} · ${number(counts.following, counts.moreFollowing)} following`;
}
