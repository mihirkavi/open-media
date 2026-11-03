import { FeedLens, LensContext, runLens } from './feedLenses';
import { SocialPost } from './posts';
import { sourceName } from './networkPosts';

/**
 * Showing a person the algorithm itself (ADR 0021, section 10): the manifest the runner executes,
 * the exact lines a change in words would edit, and what that change does to their own Feed.
 * A lens is data, not code that runs, so its manifest is the whole of its source.
 */

/** The manifest exactly as the runner reads it, without fields that only describe where it came from. */
export function lensSource(lens: FeedLens): string {
  const { builtIn: _builtIn, author: _author, ...manifest } = lens;
  return JSON.stringify(manifest, null, 2);
}

export interface SourceLine { kind: 'same' | 'add' | 'remove'; text: string }

/** A line-by-line diff (longest common subsequence), as in a code review. */
export function sourceDiff(before: string, after: string): SourceLine[] {
  const a = before.split('\n'); const b = after.split('\n');
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) for (let j = b.length - 1; j >= 0; j -= 1) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const lines: SourceLine[] = [];
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { lines.push({ kind: 'same', text: a[i] }); i += 1; j += 1; }
    else if (table[i + 1][j] >= table[i][j + 1]) { lines.push({ kind: 'remove', text: a[i] }); i += 1; }
    else { lines.push({ kind: 'add', text: b[j] }); j += 1; }
  }
  while (i < a.length) { lines.push({ kind: 'remove', text: a[i] }); i += 1; }
  while (j < b.length) { lines.push({ kind: 'add', text: b[j] }); j += 1; }
  return lines;
}

/** Only the changed lines, with up to `context` unchanged lines around each change, like a patch. */
export function changedLines(lines: SourceLine[], context = 1): SourceLine[] {
  const keep = lines.map((line, index) => line.kind !== 'same' || lines.slice(Math.max(0, index - context), index + context + 1).some((near) => near.kind !== 'same'));
  return lines.filter((_, index) => keep[index]);
}

export interface NetworkShift { network: string; before: number; after: number }

/** How many of the top `top` posts each network has before and after a change, biggest shifts first. */
export function lensImpact(posts: SocialPost[], before: FeedLens, after: FeedLens, context: LensContext = {}, top = 20): NetworkShift[] {
  const count = (lens: FeedLens) => {
    const counts = new Map<string, number>();
    for (const post of runLens(posts, lens, context).slice(0, top)) counts.set(sourceName(post.provenance.connectorId), (counts.get(sourceName(post.provenance.connectorId)) ?? 0) + 1);
    return counts;
  };
  const a = count(before); const b = count(after);
  return [...new Set([...a.keys(), ...b.keys()])]
    .map((network) => ({ network, before: a.get(network) ?? 0, after: b.get(network) ?? 0 }))
    .filter((shift) => shift.before !== shift.after)
    .sort((left, right) => Math.abs(right.after - right.before) - Math.abs(left.after - left.before));
}
