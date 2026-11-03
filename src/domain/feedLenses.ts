// Only types come from posts.ts: posts.ts runs lenses, so a value import here would be circular.
import type { SocialPost } from './posts';

/**
 * Feed lenses (ADR 0017): every way of ordering the Feed, including the built-in Raw, Relevant and Work,
 * is a small JSON manifest, never code. One runner here reads a manifest and orders posts the app or
 * an agent already loaded. A lens sees only the signals its manifest asks for, and the signals the
 * builder prompt forbids (private messages, exact location, sensitive traits, KYC documents,
 * emotional state) cannot be written in a manifest at all, so a shared lens cannot reach them.
 */

export const lensFormat = 'open-media.feed-lens/1';
/** Format 2 (ADR 0021) adds boosts and the discovery objective. A lens is written as /1 unless it uses them, so older app builds keep reading it. */
export const lensFormatV2 = 'open-media.feed-lens/2';
export type LensFormat = typeof lensFormat | typeof lensFormatV2;

export type LensSource = 'open-media' | 'farcaster' | 'lens' | 'hive' | 'deso' | 'events';
export type LensKind = 'text' | 'image' | 'video' | 'product' | 'service' | 'event' | 'job';
/** Data about the viewer or the post's audience that a lens must ask for. Post text, time, network and kind are always readable. */
export type LensPermission = 'follows' | 'interests' | 'public_engagement';

export interface LensFilters {
  /** Keep only posts from these networks. */
  sources?: LensSource[];
  /** Keep only these kinds of post. */
  kinds?: LensKind[];
  /** Keep only posts that mention at least one of these words or hashtags. */
  about?: string[];
  /** Keep only posts by people the viewer follows on Open Media. Needs the follows permission. */
  followedOnly?: boolean;
  /** Keep only posts newer than this. */
  maxAgeHours?: number;
  hideSources?: LensSource[];
  hideKinds?: LensKind[];
  /** Leave out posts that mention any of these words or hashtags. */
  mute?: string[];
  /** Leave out posts by these handles (with or without @). */
  muteAuthors?: string[];
}

/** How much each objective counts when order is "ranked". Each is 0–1; they are normalized when scored. */
export interface LensObjectives {
  recency: number;
  follows: number;
  interests: number;
  engagement: number;
  /** Spreads authors and networks out so one voice cannot fill the Feed. */
  diversity: number;
  /** Lifts authors the viewer does not follow yet (format 2). Needs the follows permission. */
  discovery?: number;
}

/**
 * Leans a ranked lens toward (weight > 0) or away from (weight < 0) one network, kind, topic or
 * person without hiding anything (format 2). A match multiplies the score by 1 + weight / 2.
 */
export interface LensBoost {
  source?: LensSource;
  kind?: LensKind;
  topic?: string;
  author?: string;
  /** −1 to 1. */
  weight: number;
}

export interface FeedLens {
  format: LensFormat;
  id: string;
  name: string;
  version: number;
  description: string;
  /** Who wrote it: "Open Media" for built-ins, otherwise the author's handle once shared. */
  author?: string;
  builtIn?: boolean;
  permissions: LensPermission[];
  filters: LensFilters;
  order: 'newest' | 'ranked';
  objectives: LensObjectives;
  /** Topics this lens favours (the interests objective), in addition to the viewer's own. */
  interests: string[];
  /** Leanings toward or away from networks, kinds, topics and people (format 2). */
  boosts?: LensBoost[];
  /** The lens this one was copied from: a shared lens, or the built-in one it tunes (“relevant”). */
  forkedFrom?: string;
}

/** What a lens may read about the viewer. The runner drops anything the manifest did not ask for. */
export interface LensContext {
  /** Open Media author ids the viewer follows (accepted follows only). */
  followedAuthorIds?: ReadonlySet<string>;
  /** Topics the viewer chose. */
  interests?: string[];
  now?: number;
}

/** Never readable by any lens; listed in every “Why this?”. */
export const forbiddenSignals = ['Private messages', 'Exact location', 'Sensitive-trait inference', 'KYC documents', 'Emotional-state prediction'] as const;

export const lensSources: LensSource[] = ['open-media', 'farcaster', 'lens', 'hive', 'deso', 'events'];
export const lensKinds: LensKind[] = ['text', 'image', 'video', 'product', 'service', 'event', 'job'];
export const lensPermissions: LensPermission[] = ['follows', 'interests', 'public_engagement'];

const noObjectives: LensObjectives = { recency: 0, follows: 0, interests: 0, engagement: 0, diversity: 0 };
const objectiveKeys: (keyof LensObjectives)[] = ['recency', 'follows', 'interests', 'engagement', 'diversity', 'discovery'];

/** The weights that make up a ranked score (diversity re-orders afterwards instead). */
function rankingWeight(objectives: LensObjectives) {
  return objectives.recency + objectives.follows + objectives.interests + objectives.engagement + (objectives.discovery ?? 0);
}

function parseBoosts(value: unknown): LensBoost[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limits.boosts) throw new LensError(`boosts must be a list of up to ${limits.boosts}.`);
  const boosts: LensBoost[] = [];
  for (const item of value) {
    const input = object(item, 'Each boost must be an object.');
    allowOnly(input, ['source', 'kind', 'topic', 'author', 'weight'], 'boost');
    const targets = (['source', 'kind', 'topic', 'author'] as const).filter((key) => input[key] !== undefined);
    if (targets.length !== 1) throw new LensError('Each boost names exactly one of source, kind, topic or author.');
    const weight = Number(input.weight);
    if (!Number.isFinite(weight) || weight < -1 || weight > 1 || weight === 0) throw new LensError('A boost weight must be between -1 and 1, and not 0.');
    const boost: LensBoost = { weight: Math.round(weight * 100) / 100 };
    const target = targets[0];
    if (target === 'source') { if (!lensSources.includes(input.source as LensSource)) throw new LensError(`boost source can only be ${lensSources.join(', ')}.`); boost.source = input.source as LensSource; }
    else if (target === 'kind') { if (!lensKinds.includes(input.kind as LensKind)) throw new LensError(`boost kind can only be ${lensKinds.join(', ')}.`); boost.kind = input.kind as LensKind; }
    else {
      const word = text(input[target], limits.word, `boost ${target}`).toLocaleLowerCase().replace(target === 'author' ? /^@/ : /^#/, '');
      if (!word) throw new LensError(`boost ${target} must not be empty.`);
      boost[target] = word;
    }
    // One boost per thing: a later one for the same target replaces the earlier.
    const existing = boosts.findIndex((other) => boostKey(other) === boostKey(boost));
    if (existing >= 0) boosts.splice(existing, 1);
    boosts.push(boost);
  }
  return boosts;
}

function boostKey(boost: LensBoost) {
  return boost.source ? `source:${boost.source}` : boost.kind ? `kind:${boost.kind}` : boost.topic ? `topic:${boost.topic}` : `author:${boost.author}`;
}

export const rawLens: FeedLens = {
  format: lensFormat, id: 'raw', name: 'Raw', version: 1, builtIn: true, author: 'Open Media',
  description: 'Every eligible post, newest first. Nothing is ranked or hidden by the lens. Raw is always available.',
  permissions: [], filters: {}, order: 'newest', objectives: { ...noObjectives, recency: 1 }, interests: [],
};

export const relevantLens: FeedLens = {
  format: lensFormat, id: 'relevant', name: 'Relevant', version: 2, builtIn: true, author: 'Open Media',
  description: 'Newer posts first, lifted when you follow the author or a post matches a topic you chose, with authors and networks spread out. Nothing else is used.',
  permissions: ['follows', 'interests'], filters: {}, order: 'ranked',
  objectives: { recency: 0.5, follows: 0.3, interests: 0.2, engagement: 0, diversity: 0.3 }, interests: [],
};

/**
 * Work (ADR 0018): the professional side of Open Media. Job posts and posts about hiring, careers,
 * launches and events in your field, lifted like Relevant. It reads nothing Relevant does not.
 */
export const workLens: FeedLens = {
  format: lensFormat, id: 'work', name: 'Work', version: 1, builtIn: true, author: 'Open Media',
  description: 'Jobs, hiring, careers, launches and professional events, newer first and lifted when you follow the author or a post matches a topic you chose. Nothing else is used.',
  permissions: ['follows', 'interests'],
  filters: { about: ['job', 'jobs', 'hiring', 'hire', 'career', 'careers', 'role', 'resume', 'interview', 'internship', 'recruiting', 'networking', 'startup', 'founder', 'conference', 'launch', 'launched', 'opentowork', 'remote', 'freelance'] },
  order: 'ranked', objectives: { recency: 0.5, follows: 0.35, interests: 0.25, engagement: 0, diversity: 0.3 }, interests: [],
};

export const builtInLenses: FeedLens[] = [relevantLens, rawLens, workLens];

/** Other words that pick a built-in lens in Search, so “jobs” or “networking” opens Work. */
export const lensAliases: Record<string, string[]> = {
  work: ['work', 'jobs', 'job', 'hiring', 'career', 'careers', 'networking', 'network', 'professional', 'linkedin', 'office', 'productive', 'recruiting'],
};

/** The built-in lens a whole Search query names through an alias, if any. */
export function builtInLensFor(query: string): FeedLens | undefined {
  const value = ` ${query.trim().toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ').replace(/\b(feed|lens|mode|show|me|the|my|open)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;
  return builtInLenses.find((lens) => (lensAliases[lens.id] ?? []).some((alias) => value === ` ${alias} `));
}
const builtInIds = builtInLenses.map((lens) => lens.id);

/** Half-life of the recency objective: a post 12 hours old counts half as much as a new one. */
export const recencyHalfLifeHours = 12;

const limits = { name: 40, description: 280, word: 40, words: 20, id: 64, maxAgeHours: 24 * 90, boosts: 24 };
/** All of a post's boosts together stay within these multipliers, so no rule can bury a post or let it take over. */
export const boostLimits = { min: 0.25, max: 2 } as const;

export class LensError extends Error {}

/**
 * Checks a manifest from anywhere (an agent, a share link, the database) and returns a clean copy.
 * Unknown fields are refused rather than ignored, so a manifest cannot smuggle in a signal.
 */
export function parseLens(value: unknown): FeedLens {
  const input = object(value, 'A lens must be a JSON object.');
  allowOnly(input, ['format', 'id', 'name', 'version', 'description', 'author', 'builtIn', 'permissions', 'filters', 'order', 'objectives', 'interests', 'boosts', 'forkedFrom', 'forbidden'], 'lens');
  if (input.format !== undefined && input.format !== lensFormat && input.format !== lensFormatV2) throw new LensError(`Unknown lens format. Use "${lensFormatV2}".`);
  const name = text(input.name, limits.name, 'name');
  if (!name) throw new LensError('A lens needs a name.');
  const derived = slug(name);
  const id = input.id === undefined ? (builtInIds.includes(derived) ? `${derived}-lens` : derived) : text(input.id, limits.id, 'id');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new LensError('A lens id may use letters, digits, - and _ only.');
  // Only Open Media's own lenses are built in; a manifest cannot claim to be one or take its id.
  const builtIn = builtInLenses.find((item) => item.id === id);
  if (builtIn && input.builtIn === true) return builtIn;
  if (builtIn) throw new LensError(`"${id}" is one of Open Media's built-in lenses. Give your copy another id.`);
  const permissions = list(input.permissions, lensPermissions, 'permissions');
  const filtersInput = input.filters === undefined ? {} : object(input.filters, 'filters must be an object.');
  allowOnly(filtersInput, ['sources', 'kinds', 'about', 'followedOnly', 'maxAgeHours', 'hideSources', 'hideKinds', 'mute', 'muteAuthors'], 'filters');
  const filters: LensFilters = {};
  const sources = list(filtersInput.sources, lensSources, 'filters.sources'); if (sources.length) filters.sources = sources;
  const kinds = list(filtersInput.kinds, lensKinds, 'filters.kinds'); if (kinds.length) filters.kinds = kinds;
  const about = words(filtersInput.about, 'filters.about'); if (about.length) filters.about = about;
  if (filtersInput.followedOnly !== undefined) {
    if (typeof filtersInput.followedOnly !== 'boolean') throw new LensError('filters.followedOnly must be true or false.');
    if (filtersInput.followedOnly) filters.followedOnly = true;
  }
  if (filtersInput.maxAgeHours !== undefined) {
    const hours = Number(filtersInput.maxAgeHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > limits.maxAgeHours) throw new LensError(`filters.maxAgeHours must be between 1 and ${limits.maxAgeHours}.`);
    filters.maxAgeHours = Math.round(hours);
  }
  const hideSources = list(filtersInput.hideSources, lensSources, 'filters.hideSources'); if (hideSources.length) filters.hideSources = hideSources;
  const hideKinds = list(filtersInput.hideKinds, lensKinds, 'filters.hideKinds'); if (hideKinds.length) filters.hideKinds = hideKinds;
  const mute = words(filtersInput.mute, 'filters.mute'); if (mute.length) filters.mute = mute;
  const muteAuthors = words(filtersInput.muteAuthors, 'filters.muteAuthors').map((handle) => handle.replace(/^@/, '')); if (muteAuthors.length) filters.muteAuthors = muteAuthors;
  const order = input.order === undefined ? 'ranked' : input.order;
  if (order !== 'newest' && order !== 'ranked') throw new LensError('order must be "newest" or "ranked".');
  const objectivesInput = input.objectives === undefined ? {} : object(input.objectives, 'objectives must be an object.');
  allowOnly(objectivesInput, objectiveKeys, 'objectives');
  const objectives = { ...noObjectives };
  for (const key of objectiveKeys) {
    if (objectivesInput[key] === undefined) continue;
    const weight = Number(objectivesInput[key]);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new LensError(`objectives.${key} must be between 0 and 1.`);
    objectives[key] = Math.round(weight * 100) / 100;
  }
  // Discovery is written only when used, so a lens without it stays format 1.
  if (!objectives.discovery) delete objectives.discovery;
  if (order === 'ranked' && rankingWeight(objectives) === 0) objectives.recency = 1;
  const boosts = parseBoosts(input.boosts);
  const needs: [boolean, LensPermission, string][] = [
    [Boolean(filters.followedOnly) || objectives.follows > 0 || Boolean(objectives.discovery), 'follows', 'who you follow'],
    [objectives.interests > 0, 'interests', 'your interests'],
    [objectives.engagement > 0, 'public_engagement', 'public like and repost counts'],
  ];
  for (const [needed, permission, label] of needs) {
    if (needed && !permissions.includes(permission)) throw new LensError(`This lens uses ${label}, so permissions must include "${permission}".`);
  }
  const lens: FeedLens = {
    format: boosts.length || objectives.discovery ? lensFormatV2 : lensFormat, id, name,
    version: input.version === undefined ? 1 : Math.max(1, Math.min(10_000, Math.floor(Number(input.version)) || 1)),
    description: text(input.description ?? '', limits.description, 'description'),
    permissions, filters, order, objectives,
    interests: words(input.interests, 'interests'),
  };
  if (boosts.length) lens.boosts = boosts;
  if (typeof input.author === 'string' && input.author.trim()) lens.author = text(input.author, limits.name, 'author');
  if (typeof input.forkedFrom === 'string' && input.forkedFrom.trim()) lens.forkedFrom = text(input.forkedFrom, limits.id, 'forkedFrom');
  return lens;
}

/** A lens by id among the built-ins and the given saved lenses; falls back to Relevant. */
export function lensById(id: string | undefined, saved: FeedLens[] = []): FeedLens {
  return [...builtInLenses, ...saved].find((lens) => lens.id === id) ?? relevantLens;
}

/** The kinds a post counts as, for kind filters. */
export function postKinds(post: SocialPost): LensKind[] {
  const kinds: LensKind[] = [];
  if (post.media?.some((item) => item.kind === 'video') || post.kind === 'video') kinds.push('video');
  if (post.media?.some((item) => item.kind === 'image') || post.kind === 'image') kinds.push('image');
  if (post.listing?.kind === 'product') kinds.push('product');
  if (post.listing?.kind === 'service') kinds.push('service');
  if (post.event || post.listing?.kind === 'event') kinds.push('event');
  if (post.listing?.kind === 'job') kinds.push('job');
  if (!kinds.length) kinds.push('text');
  return kinds;
}

/** Which of the given words or hashtags a post mentions, as whole words in its title, text or topics. */
export function matchingTopics(post: SocialPost, topics: string[]): string[] {
  if (!topics.length) return [];
  const haystack = ` ${[post.title ?? '', post.body, post.listing?.title ?? '', post.listing?.kind ?? '', post.event?.title ?? '', ...post.topics].join(' ').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ')} `;
  return topics.filter((topic) => {
    const word = topic.toLocaleLowerCase().replace(/^#/, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim();
    return word.length > 0 && haystack.includes(` ${word} `);
  });
}

interface Signals { interestsAllowed: boolean; followsAllowed: boolean; followed: ReadonlySet<string>; interests: string[]; now: number }

/** Followed when the viewer's follows say so, or the source itself marked the author as followed. */
function isFollowed(post: SocialPost, signals: Signals) {
  return signals.followsAllowed && (signals.followed.has(post.author.id) || post.relevance.followsAuthor);
}

/** The context reduced to what the manifest asked for. */
function permittedSignals(lens: FeedLens, context: LensContext): Signals {
  return {
    interestsAllowed: lens.permissions.includes('interests'),
    followsAllowed: lens.permissions.includes('follows'),
    followed: lens.permissions.includes('follows') ? context.followedAuthorIds ?? new Set() : new Set(),
    interests: lens.permissions.includes('interests') ? unique([...lens.interests, ...(context.interests ?? [])]) : [],
    now: context.now ?? Date.now(),
  };
}

function createdAt(post: SocialPost) {
  const time = Date.parse(post.createdAt);
  return Number.isFinite(time) ? time : 0;
}

/** Newest first, with the id breaking ties so the order is the same on every device. */
function newestFirst(a: SocialPost, b: SocialPost) {
  return createdAt(b) - createdAt(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Whether the lens keeps a post, and if not, why. */
export function lensKeeps(post: SocialPost, lens: FeedLens, context: LensContext = {}): { kept: boolean; reason?: string } {
  const signals = permittedSignals(lens, context);
  const { filters } = lens;
  const source = post.provenance.connectorId as LensSource;
  const kinds = postKinds(post);
  const handle = post.author.handle.replace(/^@/, '').toLocaleLowerCase();
  if (filters.sources && !filters.sources.includes(source)) return { kept: false, reason: `Not from ${listNames(filters.sources)}` };
  if (filters.hideSources?.includes(source)) return { kept: false, reason: `Hides ${sourceName(source)}` };
  if (filters.kinds && !kinds.some((kind) => filters.kinds!.includes(kind))) return { kept: false, reason: `Not ${listKinds(filters.kinds)}` };
  if (filters.hideKinds && kinds.some((kind) => filters.hideKinds!.includes(kind))) return { kept: false, reason: `Hides ${listKinds(filters.hideKinds)}` };
  if (filters.maxAgeHours && signals.now - createdAt(post) > filters.maxAgeHours * 3_600_000) return { kept: false, reason: `Older than ${ageLabel(filters.maxAgeHours)}` };
  if (filters.followedOnly && !isFollowed(post, signals)) return { kept: false, reason: 'Not by someone you follow' };
  if (filters.muteAuthors?.some((item) => item.toLocaleLowerCase() === handle)) return { kept: false, reason: `Mutes @${handle}` };
  const muted = matchingTopics(post, filters.mute ?? []);
  if (muted.length) return { kept: false, reason: `Mutes ${muted.join(', ')}` };
  if (filters.about && !matchingTopics(post, filters.about).length) return { kept: false, reason: `Not about ${filters.about.join(', ')}` };
  return { kept: true };
}

/** Each objective's 0–1 value for one post. */
function objectiveValues(post: SocialPost, signals: Signals) {
  const ageHours = Math.max(0, (signals.now - createdAt(post)) / 3_600_000);
  const engagement = post.engagement ? post.engagement.likes + post.engagement.reposts * 2 + post.engagement.replies : 0;
  return {
    recency: Math.pow(0.5, ageHours / recencyHalfLifeHours),
    follows: isFollowed(post, signals) ? 1 : 0,
    interests: signals.interestsAllowed && (matchingTopics(post, signals.interests).length || post.relevance.selectedInterestMatches.length) ? 1 : 0,
    engagement: Math.min(1, Math.log1p(engagement) / Math.log1p(1000)),
    // Only meaningful when the lens may read follows; otherwise every author would count as new.
    discovery: signals.followsAllowed && !isFollowed(post, signals) ? 1 : 0,
  };
}

/** Whether a boost's network, kind, topic or person matches a post. */
function boostMatches(post: SocialPost, boost: LensBoost): boolean {
  if (boost.source) return post.provenance.connectorId === boost.source;
  if (boost.kind) return postKinds(post).includes(boost.kind);
  if (boost.topic) return matchingTopics(post, [boost.topic]).length > 0;
  return post.author.handle.replace(/^@/, '').toLocaleLowerCase() === boost.author;
}

export interface LensScoreParts {
  /** 0–100 before boosts. */
  base: number;
  /** 0–200 after boosts. */
  score: number;
  /** Each objective's points out of its share of 100. */
  objectives: { key: keyof LensObjectives; label: string; points: number; max: number }[];
  /** Boosts that matched, with what they multiplied the score by. */
  boosts: { boost: LensBoost; rule: string; factor: number }[];
  /** All boosts together, after the cap. */
  factor: number;
}

const objectiveLabels: Record<Exclude<keyof LensObjectives, 'diversity'>, string> = { recency: 'Newness', follows: 'Who you follow', interests: 'Your topics', engagement: 'Public likes and reposts', discovery: 'New voices' };

/** How a ranked lens scores one post: each objective's points and each boost's multiplier. */
export function lensScoreParts(post: SocialPost, lens: FeedLens, context: LensContext = {}): LensScoreParts {
  const signals = permittedSignals(lens, context);
  const values = objectiveValues(post, signals);
  const { objectives } = lens;
  const weights: Record<keyof typeof objectiveLabels, number> = {
    recency: objectives.recency, follows: objectives.follows, interests: objectives.interests,
    engagement: lens.permissions.includes('public_engagement') ? objectives.engagement : 0,
    discovery: objectives.discovery ?? 0,
  };
  const total = Object.values(weights).reduce((sum, weight) => sum + weight, 0) || 1;
  const parts = (Object.keys(weights) as (keyof typeof weights)[]).filter((key) => weights[key] > 0).map((key) => ({ key, label: objectiveLabels[key], points: (values[key] * weights[key] / total) * 100, max: (weights[key] / total) * 100 }));
  const base = parts.reduce((sum, part) => sum + part.points, 0);
  const matched = lens.order === 'ranked' ? (lens.boosts ?? []).filter((boost) => boostMatches(post, boost)).map((boost) => ({ boost, rule: describeBoost(boost), factor: 1 + boost.weight / 2 })) : [];
  const factor = Math.min(boostLimits.max, Math.max(boostLimits.min, matched.reduce((product, item) => product * item.factor, 1)));
  return { base, score: base * factor, objectives: parts, boosts: matched, factor };
}

export function lensScore(post: SocialPost, lens: FeedLens, context: LensContext = {}): number {
  return lensScoreParts(post, lens, context).score / 100;
}

/** How many of the latest posts count when spreading networks out. */
const networkWindow = 3;

/** Orders posts through a lens: filters first, then newest first or by score with authors spread out. */
export function runLens(posts: SocialPost[], lens: FeedLens, context: LensContext = {}): SocialPost[] {
  const kept = posts.filter((post) => lensKeeps(post, lens, context).kept);
  if (lens.order === 'newest') return kept.sort(newestFirst);
  const scored = kept.map((post) => ({ post, score: lensScore(post, lens, context) })).sort((a, b) => b.score - a.score || newestFirst(a.post, b.post));
  const diversity = lens.objectives.diversity;
  if (!diversity) return scored.map((item) => item.post);
  // Greedy re-rank: each post already shown from the same author lowers the next one's score, and so
  // does each of the last few posts from the same network, so the Feed alternates voices and one
  // busy network can't fill a screen. Nobody is hidden; they only move down.
  const authorSeen = new Map<string, number>();
  const ordered: SocialPost[] = [];
  const remaining = [...scored];
  while (remaining.length) {
    let best = 0;
    let bestScore = -Infinity;
    const recent = ordered.slice(-networkWindow).map((post) => post.provenance.connectorId);
    // Looking ahead a bounded window keeps this fast on long feeds; scores only fall further down.
    for (let index = 0; index < Math.min(remaining.length, 40); index += 1) {
      const { post, score } = remaining[index];
      const sameNetwork = recent.filter((source) => source === post.provenance.connectorId).length;
      const adjusted = score * Math.pow(1 - diversity * 0.5, authorSeen.get(post.author.id) ?? 0) * Math.pow(1 - diversity, sameNetwork);
      if (adjusted > bestScore) { best = index; bestScore = adjusted; }
    }
    const [{ post }] = remaining.splice(best, 1);
    ordered.push(post);
    authorSeen.set(post.author.id, (authorSeen.get(post.author.id) ?? 0) + 1);
  }
  return ordered;
}

export interface LensExplanation {
  /** Signals this lens used for this post. */
  used: string[];
  /** The lens's own rules that this post passed. */
  rules: string[];
  /** How the lens weighed this post under its own weights: the score, each objective's points, each boost (ADR 0021). */
  scoring: string[];
  /** Words that would tune the lens for posts like this one, as a hint (there is no button). */
  tuneHint: string;
  /** What the lens is allowed to read but did not, and what no lens can read. */
  notUsed: string[];
}

/** The score as short lines: “Score 68 of 100”, “Newness 31 of 33 · Who you follow 33 of 33”, “More videos ×1.5”. */
export function describeScore(post: SocialPost, lens: FeedLens, context: LensContext = {}): string[] {
  if (lens.order === 'newest') return [`${lens.name} is newest first: posts have no score`];
  const parts = lensScoreParts(post, lens, context);
  const lines = [`Score ${Math.round(parts.score)} of 100`, parts.objectives.map((part) => `${part.label} ${Math.round(part.points)} of ${Math.round(part.max)}`).join(' · ')];
  if (parts.boosts.length) lines.push(`${parts.boosts.map((item) => `${item.rule} ×${formatFactor(item.factor)}`).join(' · ')}${parts.factor !== parts.boosts.reduce((product, item) => product * item.factor, 1) ? ` (capped at ×${formatFactor(parts.factor)})` : ''}`);
  if (lens.objectives.diversity) lines.push('Then spread out so one author or network can’t fill the Feed');
  return lines;
}

function formatFactor(value: number) {
  return String(Math.round(value * 100) / 100);
}

/** The words that would lean the lens away from this post's network and toward its kind. */
function tuneHintFor(post: SocialPost, lens: FeedLens, signals: Signals): string {
  const kind = postKinds(post)[0];
  const source = sourceName(post.provenance.connectorId).toLocaleLowerCase();
  const name = lens.builtIn ? `your own ${lens.name}` : lens.name;
  const tune = `To change ${name}, type “less ${source}” or “more ${kindLabels[kind]}” in Settings → Feed or in Search.`;
  // With nobody followed and no topics, a lens that reads only those has little to go on: say so.
  const reads = (lens.objectives.follows > 0 && signals.followsAllowed) || (lens.objectives.interests > 0 && signals.interestsAllowed);
  const hasSignals = signals.followed.size > 0 || signals.interests.length > 0;
  if (lens.order !== 'ranked' || !reads || hasSignals) return tune;
  return `${lens.name} has only newness and the network mix to go on: you follow no one yet and chose no topics. Follow people, or type “more about design” (any topic), and it will lift those posts. ${tune}`;
}

export function explainLensPost(post: SocialPost, lens: FeedLens, context: LensContext = {}): LensExplanation {
  const signals = permittedSignals(lens, context);
  const now = signals.now;
  const used: string[] = [];
  if (isFollowed(post, signals)) used.push('You follow this author');
  matchingTopics(post, signals.interests).forEach((topic) => used.push(`Matches your ${topic} interest`));
  if (signals.interestsAllowed && !matchingTopics(post, signals.interests).length) post.relevance.selectedInterestMatches.forEach((topic) => used.push(`Matches your ${topic} interest`));
  if (post.relevance.communityMatch) used.push(`From ${post.relevance.communityMatch}`);
  if (post.eligibility) used.push(post.eligibility.selection);
  const time = createdAt(post);
  if (time) used.push(`Posted ${postedLabel(now - time)}`);
  if (lens.permissions.includes('public_engagement') && lens.objectives.engagement > 0 && post.engagement) used.push(`${post.engagement.likes} likes and ${post.engagement.reposts} reposts on ${sourceName(post.provenance.connectorId)}`);
  used.push(lens.order === 'newest' ? `${lens.name}: newest first` : `Selected by ${lens.name}`);
  const notUsed: string[] = [];
  if (!lens.permissions.includes('follows')) notUsed.push('Who you follow');
  if (!lens.permissions.includes('interests')) notUsed.push('Your interests');
  if (!lens.permissions.includes('public_engagement') || !lens.objectives.engagement) notUsed.push('Like and repost counts');
  notUsed.push(...forbiddenSignals);
  return { used, rules: describeLensRules(lens), scoring: describeScore(post, lens, context), tuneHint: tuneHintFor(post, lens, signals), notUsed };
}

/** The lens's filters and ordering as short plain sentences, for “Why this?”, Search and agents. */
export function describeLensRules(lens: FeedLens): string[] {
  const { filters } = lens;
  const rules: string[] = [];
  if (filters.kinds) rules.push(`Only ${listKinds(filters.kinds)}`);
  if (filters.sources) rules.push(`Only from ${listNames(filters.sources)}`);
  if (filters.followedOnly) rules.push('Only people you follow');
  if (filters.about) rules.push(`About ${filters.about.join(', ')}`);
  if (filters.maxAgeHours) rules.push(`From the last ${ageLabel(filters.maxAgeHours)}`);
  if (filters.hideKinds) rules.push(`No ${listKinds(filters.hideKinds)}`);
  if (filters.hideSources) rules.push(`Nothing from ${listNames(filters.hideSources)}`);
  if (filters.mute) rules.push(`Mutes ${filters.mute.join(', ')}`);
  if (filters.muteAuthors) rules.push(`Mutes ${filters.muteAuthors.map((handle) => `@${handle}`).join(', ')}`);
  if (lens.order === 'newest') rules.push('Newest first');
  else {
    const { objectives } = lens;
    const parts: [number, string][] = [[objectives.recency, 'newness'], [objectives.follows, 'who you follow'], [objectives.interests, lens.interests.length ? `topics (${lens.interests.join(', ')})` : 'your topics'], [objectives.engagement, 'public likes and reposts'], [objectives.discovery ?? 0, 'new voices']];
    const total = parts.reduce((sum, [weight]) => sum + weight, 0) || 1;
    rules.push(`Ranked by ${parts.filter(([weight]) => weight > 0).map(([weight, label]) => `${label} ${Math.round((weight / total) * 100)}%`).join(', ')}`);
    if (objectives.diversity) rules.push('Spreads authors and networks out');
    rules.push(...(lens.boosts ?? []).map(describeBoost));
  }
  return rules;
}

/** One boost in words: “More videos”, “Much less Hive”, “A bit more about design”, “Less from @bot”. */
export function describeBoost(boost: LensBoost): string {
  const size = Math.abs(boost.weight);
  // Kinds are counted (“fewer videos”); networks, topics and people are not (“less Hive”).
  const direction = boost.weight > 0 ? 'more' : boost.kind ? 'fewer' : 'less';
  const amount = size >= 0.75 ? `${direction === 'fewer' ? 'Far' : 'Much'} ${direction}` : size <= 0.3 ? `${direction === 'more' ? 'A bit' : 'Slightly'} ${direction}` : direction[0].toLocaleUpperCase() + direction.slice(1);
  const what = boost.source ? sourceName(boost.source) : boost.kind ? kindLabels[boost.kind] : boost.topic ? `about ${boost.topic}` : `from @${boost.author}`;
  return `${amount} ${what}`;
}

/** One line for a lens: its rules joined, used as its summary in Search and in agent replies. */
export function lensSummary(lens: FeedLens): string {
  return describeLensRules(lens).join(' · ');
}

// ---------- Writing a lens in plain words ----------

export interface LensDraft {
  lens: FeedLens;
  /** What was understood, in the same words shown back to the person. */
  understood: string[];
  /** Words that were not turned into a rule, so nothing is silently guessed. */
  unused: string[];
}

const kindWords: [RegExp, LensKind[], string][] = [
  [/\b(videos?|clips?|shorts?|reels?)\b/gi, ['video'], 'videos'],
  [/\b(photos?|images?|pictures?|pics?)\b/gi, ['image'], 'images'],
  [/\b(text[- ]only|text posts?|no media|just text|words only)\b/gi, ['text'], 'text posts'],
  [/\b(listings?|marketplace|things for sale|for sale)\b/gi, ['product', 'service'], 'listings'],
  [/\b(products?|stuff to buy|shopping)\b/gi, ['product'], 'products'],
  [/\b(services?|freelancers?|gigs?)\b/gi, ['service'], 'services'],
  [/\b(events?|meetups?|happenings?)\b/gi, ['event'], 'events'],
  [/\b(job (?:posts?|listings?|openings?)|vacanc(?:y|ies)|openings?)\b/gi, ['job'], 'job posts'],
];
const sourceWords: [RegExp, LensSource][] = [[/\b(farcaster|warpcast)\b/gi, 'farcaster'], [/\blens\b(?!\s+(?:called|named))/gi, 'lens'], [/\bhive\b/gi, 'hive'], [/\bdeso\b/gi, 'deso'], [/\bopen media\b/gi, 'open-media']];
const negative = /^\s*(?:and\s+|but\s+|also\s+)?(?:no|hide|hiding|without|mute|muting|not|never|skip|exclude|excluding|remove|block|less|fewer|stop showing|don'?t show|do not show|nothing (?:about|from|on))\b/i;
const filler = new Set(['a', 'an', 'the', 'my', 'me', 'i', 'want', 'show', 'give', 'make', 'create', 'build', 'set', 'up', 'feed', 'lens', 'algorithm', 'timeline', 'only', 'just', 'posts', 'post', 'stuff', 'things', 'content', 'from', 'by', 'on', 'of', 'in', 'to', 'for', 'with', 'and', 'or', 'that', 'is', 'are', 'please', 'which', 'where', 'all', 'any', 'some', 'more', 'less', 'about', 'mentioning', 'covering', 'related', 'like', 'no', 'hide', 'without', 'mute', 'not', 'never', 'skip', 'exclude', 'remove', 'block', 'also', 'but', 'everything', 'anything', 'people', 'accounts', 'follow', 'following', 'follows', 'newest', 'latest', 'first', 'chronological', 'order', 'mostly', 'mainly', 'lot', 'lots', 'can', 'you', 'could', 'would', 'let', 'see', 'into', 'interested', 'am', "i'm", 'im', 'new', 'one', 'called', 'named', 'it', 'them', 'those', 'these', 'what', 'who', 'do', 'don\'t', 'dont', 'stop', 'showing', 'see', 'nothing', 'none']);

/** Whether a search reads like a request for a different Feed rather than a search for posts. */
export function looksLikeLensRequest(input: string): boolean {
  const value = input.trim().toLocaleLowerCase();
  if (value.length < 4) return false;
  // “lens” alone is also a network (“ethereum on lens”), so only “feed lens” counts.
  return /\b(feed|feed lens|algorithm|timeline)\b/.test(value)
    || /^(only|just|hide|mute|no|without|never show|stop showing|don'?t show|less|fewer|more)\b/.test(value)
    || /\b(people|accounts) i follow\b/.test(value)
    || /\b(i'?m|i am) (into|interested in)\b/.test(value)
    || /\bnewest first|chronological\b/.test(value);
}

/**
 * Turns a plain request such as “only videos about cooking, no crypto, from people I follow” into a
 * lens. It runs on the device with fixed rules, so the same words always give the same lens, and
 * everything it understood or skipped is shown back.
 */
export function lensFromRequest(input: string): LensDraft {
  const request = input.trim().slice(0, 400);
  const understood: string[] = [];
  const unused: string[] = [];
  const filters: LensFilters = {};
  const permissions = new Set<LensPermission>();
  const interests: string[] = [];
  const objectives: LensObjectives = { ...relevantLens.objectives, follows: 0, interests: 0 };
  let order: FeedLens['order'] = 'ranked';
  let name = '';
  let rest = ` ${request} `;
  const nameMatch = rest.match(/\b(?:called|named|name it)\s+["“']?([^"”',.;]{2,40})/i);
  if (nameMatch) { name = nameMatch[1].trim(); rest = rest.replace(nameMatch[0], ' '); }

  if (/\b(newest first|latest first|chronological|in order|by time|no ranking)\b/i.test(rest)) { order = 'newest'; understood.push('Newest first'); rest = rest.replace(/\b(newest first|latest first|chronological|in order|by time|no ranking)\b/gi, ' '); }
  if (/\b(surprise me|variety|diverse|diversity|mix it up|discover|serendipity)\b/i.test(rest)) { objectives.diversity = 0.7; understood.push('Spread authors out'); rest = rest.replace(/\b(surprise me|variety|diverse|diversity|mix it up|discover|serendipity)\b/gi, ' '); }
  if (/\b(popular|trending|most liked|top posts)\b/i.test(rest)) { objectives.engagement = 0.3; permissions.add('public_engagement'); understood.push('Lift posts with more public likes and reposts'); rest = rest.replace(/\b(popular|trending|most liked|top posts)\b/gi, ' '); }
  const followPattern = /\b(?:(?:the\s+)?(?:people|accounts|those|folks|friends)\s+i\s+follow|my follows|my friends|people i know|following)\b/i;
  if (followPattern.test(rest)) {
    permissions.add('follows');
    if (/\bmore\b[^,.;]*\b(?:people|accounts|those|folks|friends)\s+i\s+follow|\bmore\b[^,.;]*\bfriends\b/i.test(rest)) { objectives.follows = 0.5; understood.push('Lift people you follow'); }
    else { filters.followedOnly = true; understood.push('Only people you follow'); }
    rest = rest.replace(new RegExp(followPattern.source, 'gi'), ' ');
  }
  const hours = rest.match(/\b(?:last|past)\s+(\d{1,3})\s+(hours?|days?)\b/i);
  if (hours) { filters.maxAgeHours = Number(hours[1]) * (/day/i.test(hours[2]) ? 24 : 1); rest = rest.replace(hours[0], ' '); }
  else if (/\b(today|last 24 hours|past day)\b/i.test(rest)) { filters.maxAgeHours = 24; rest = rest.replace(/\b(today|last 24 hours|past day)\b/gi, ' '); }
  else if (/\b(this week|past week|last week|last 7 days)\b/i.test(rest)) { filters.maxAgeHours = 168; rest = rest.replace(/\b(this week|past week|last week|last 7 days)\b/gi, ' '); }
  if (filters.maxAgeHours) understood.push(`From the last ${ageLabel(filters.maxAgeHours)}`);

  // Clauses carry their own polarity: “videos about cooking, no crypto” keeps cooking and mutes crypto.
  const clauses = rest.split(/[,;.]|\bbut\b|\bexcept\b|\b(?:and|also)\b(?=\s+(?:no|hide|without|mute|not|never|skip|less|fewer)\b)/i).map((clause) => clause.trim()).filter(Boolean);
  for (const original of clauses) {
    let clause = ` ${original} `;
    const isNegative = negative.test(original) || /\bexcept\b/i.test(original);
    for (const [pattern, kinds, label] of kindWords) {
      if (!new RegExp(pattern.source, 'i').test(clause)) continue;
      const key = isNegative ? 'hideKinds' : 'kinds';
      filters[key] = unique([...(filters[key] ?? []), ...kinds]) as LensKind[];
      understood.push(isNegative ? `No ${label}` : `Only ${label}`);
      clause = clause.replace(pattern, ' ');
    }
    const named = sourceWords.filter(([pattern]) => new RegExp(pattern.source, 'i').test(clause)).map(([pattern, source]) => { clause = clause.replace(pattern, ' '); return source; });
    if (named.length) {
      const key = isNegative ? 'hideSources' : 'sources';
      filters[key] = unique([...(filters[key] ?? []), ...named]) as LensSource[];
      understood.push(`${isNegative ? 'Nothing from' : 'Only from'} ${listNames(named)}`);
    }
    const handles = [...clause.matchAll(/@([a-z0-9_.-]{2,40})/gi)].map((match) => match[1]);
    if (handles.length && isNegative) { filters.muteAuthors = unique([...(filters.muteAuthors ?? []), ...handles]); understood.push(`Mute ${handles.map((handle) => `@${handle}`).join(', ')}`); }
    clause = clause.replace(/@[a-z0-9_.-]{2,40}/gi, ' ');
    const topicPart = clause.match(/\b(?:about|on|mentioning|covering|related to|into|interested in|like|for)\s+(.+)$/i);
    const tokens = (isNegative || !topicPart ? clause : topicPart[1]).toLocaleLowerCase().replace(/[^\p{L}\p{N}#\s'-]/gu, ' ').split(/\s+/).map((word) => word.replace(/^['-]+|['-]+$/g, '')).filter((word) => word.length > 1 && !filler.has(word));
    if (!tokens.length) continue;
    if (isNegative) {
      filters.mute = unique([...(filters.mute ?? []), ...tokens]);
      understood.push(`Mute ${tokens.join(', ')}`);
    } else if (topicPart || tokens.some((token) => token.startsWith('#'))) {
      const topics = tokens.map((token) => token.replace(/^#/, ''));
      if (/\bmore\b/i.test(original) || /\b(?:into|interested in)\b/i.test(original)) {
        interests.push(...topics); permissions.add('interests'); objectives.interests = Math.max(objectives.interests, 0.3);
        understood.push(`Lift ${topics.join(', ')}`);
      } else {
        filters.about = unique([...(filters.about ?? []), ...topics]);
        understood.push(`About ${topics.join(', ')}`);
      }
    } else unused.push(...tokens);
  }
  if (order === 'ranked' && objectives.follows === 0 && filters.followedOnly === undefined && !permissions.has('follows')) {
    // Without a stated preference, rank like Relevant does.
    permissions.add('follows'); objectives.follows = relevantLens.objectives.follows;
  }
  if (order === 'ranked' && !permissions.has('interests')) { permissions.add('interests'); objectives.interests = relevantLens.objectives.interests; }
  const lens = parseLens({
    format: lensFormat,
    name: name || defaultName(filters, interests),
    description: `Made from: “${request.slice(0, 200)}”`,
    permissions: [...permissions], filters, order, objectives, interests: unique(interests),
  });
  return { lens, understood: unique(understood), unused: unique(unused) };
}

function defaultName(filters: LensFilters, interests: string[]): string {
  const topic = filters.about?.[0] ?? interests[0];
  const kind = filters.kinds?.length === 1 ? { text: 'Text', image: 'Images', video: 'Videos', product: 'Products', service: 'Services', event: 'Events', job: 'Jobs' }[filters.kinds[0]] : undefined;
  const parts = [filters.followedOnly ? 'Following' : '', topic ? capitalize(topic) : '', kind ?? ''].filter(Boolean);
  if (!parts.length && filters.sources?.length === 1) parts.push(sourceName(filters.sources[0]));
  if (!parts.length && (filters.mute || filters.hideKinds || filters.hideSources)) parts.push('Quiet');
  return (parts.join(' ') || 'My feed').slice(0, limits.name);
}

// ---------- Tuning a lens in plain words (ADR 0021) ----------

export interface LensTuning extends LensDraft {
  /** Rules that are new or gone compared with the lens before: “Now: More videos”, “No longer: Mutes crypto”. */
  changes: string[];
}

const tuneStart = /^\s*(?:please\s+)?(?:(?:show|give)(?:\s+me)?\s+|i\s+want\s+)?(?:a\s+(?:lot|bit|little)\s+|much\s+|way\s+|slightly\s+|somewhat\s+)?(?:more|less|fewer|no\s+more|unmute|bring\s+back|stop\s+hiding|tune|adjust)\s+\S/i;

/** Whether a search reads like a change to the lens in use (“less hive”, “more videos”, “show hive again”). */
export function looksLikeTuneRequest(input: string): boolean {
  const value = input.trim();
  if (value.length < 4) return false;
  return value.split(/[,;]|\band\b/i).some((clause) => tuneStart.test(clause)) || /\b(?:again|tune|adjust)\b/i.test(value) && /\b(show|bring|see|tune|adjust)\b/i.test(value);
}

/** The id and name a person's own copy of a built-in lens gets: Relevant → “My Relevant”. */
export function ownCopyId(lens: FeedLens): string {
  return lens.builtIn ? `my-${lens.id}` : lens.id;
}

const objectiveWords: [RegExp, keyof LensObjectives, LensPermission | undefined][] = [
  [/\b(?:new\s+voices|new\s+people|people\s+i\s+don'?t\s+follow|strangers|discover(?:y|ies)?|surprises?|serendipity)\b/i, 'discovery', 'follows'],
  [/\b(?:(?:the\s+)?(?:people|accounts|folks|friends)\s+i\s+follow|my\s+follows|my\s+friends|following)\b/i, 'follows', 'follows'],
  [/\b(?:recent|newer|fresh(?:er)?|latest|new\s+posts|new\s+stuff)\b/i, 'recency', undefined],
  [/\b(?:variety|diverse|diversity|different\s+voices|mix(?:ed)?)\b/i, 'diversity', undefined],
  [/\b(?:popular|trending|most\s+liked|liked)\b/i, 'engagement', 'public_engagement'],
  [/\b(?:my\s+topics|my\s+interests)\b/i, 'interests', 'interests'],
];
const objectiveNames: Record<keyof LensObjectives, string> = { recency: 'newness', follows: 'who you follow', interests: 'your topics', engagement: 'public likes and reposts', diversity: 'variety', discovery: 'new voices' };

/**
 * Changes a lens with the same fixed rules as lensFromRequest: “less hive, a lot more videos, unmute
 * crypto”. A built-in lens is never changed: the first change makes the person's own copy (“My
 * Relevant”), which later changes tune. Everything understood, skipped and changed is reported.
 */
export function tuneLens(base: FeedLens, input: string): LensTuning {
  const request = input.trim().slice(0, 400);
  const understood: string[] = [];
  const unused: string[] = [];
  const before = describeLensRules(base);
  const filters: LensFilters = JSON.parse(JSON.stringify(base.filters));
  const objectives: LensObjectives = { ...base.objectives };
  const permissions = new Set(base.permissions);
  let boosts: LensBoost[] = (base.boosts ?? []).map((boost) => ({ ...boost }));
  let order = base.order;
  let ranks = false;

  const addBoost = (boost: Omit<LensBoost, 'weight'>, weight: number) => {
    const key = boostKey({ ...boost, weight });
    const existing = boosts.find((item) => boostKey(item) === key);
    const next = Math.max(-1, Math.min(1, Math.round(((existing?.weight ?? 0) + weight) * 100) / 100));
    boosts = boosts.filter((item) => boostKey(item) !== key);
    if (next !== 0) boosts.push({ ...boost, weight: next });
    understood.push(next === 0 ? `No longer leans on ${describeBoost({ ...boost, weight: 1 }).replace(/^Much more /, '')}` : describeBoost({ ...boost, weight: next }));
    ranks = true;
  };
  // Showing something again removes every rule that hid or lowered it.
  const restore = (match: { source?: LensSource; kind?: LensKind; word?: string }) => {
    if (match.source) { filters.hideSources = filters.hideSources?.filter((item) => item !== match.source); boosts = boosts.filter((item) => !(item.source === match.source && item.weight < 0)); understood.push(`Show ${sourceName(match.source)} again`); }
    if (match.kind) { filters.hideKinds = filters.hideKinds?.filter((item) => item !== match.kind); boosts = boosts.filter((item) => !(item.kind === match.kind && item.weight < 0)); understood.push(`Show ${kindLabels[match.kind]} again`); }
    if (match.word) {
      const word = match.word.replace(/^[@#]/, '');
      filters.mute = filters.mute?.filter((item) => item !== word);
      filters.muteAuthors = filters.muteAuthors?.filter((item) => item.toLocaleLowerCase() !== word);
      boosts = boosts.filter((item) => !((item.topic === word || item.author === word) && item.weight < 0));
      understood.push(`Unmute ${match.word}`);
    }
  };

  let rest = ` ${request} `;
  if (/\b(newest first|latest first|chronological|in order|by time|no ranking)\b/i.test(rest)) { order = 'newest'; understood.push('Newest first'); rest = rest.replace(/\b(newest first|latest first|chronological|in order|by time|no ranking)\b/gi, ' '); }
  else if (/\b(ranked|rank it|rank them)\b/i.test(rest)) { order = 'ranked'; understood.push('Ranked'); rest = rest.replace(/\b(ranked|rank it|rank them)\b/gi, ' '); }

  const clauses = rest.split(/[,;.]|\bbut\b|\b(?:and|also|plus)\b(?=\s+(?:a\s+(?:lot|bit|little)\s+|much\s+|way\s+|slightly\s+)?(?:more|less|fewer|no|hide|without|mute|unmute|only|show|bring)\b)/i).map((clause) => clause.trim()).filter(Boolean);
  for (const original of clauses) {
    const leaning = original.match(/^(?:please\s+)?(?:(?:show|give)(?:\s+me)?\s+|i\s+want\s+)?(a\s+lot\s+|much\s+|way\s+|a\s+(?:bit|little)\s+|slightly\s+|somewhat\s+)?(more|less|fewer)\b(?!\s+than)/i);
    const again = /\b(?:again|unmute|bring\s+back|stop\s+hiding)\b/i.test(original);
    if (leaning && !/^no\s+more\b/i.test(original)) {
      const sizeWord = (leaning[1] ?? '').trim().toLocaleLowerCase();
      const size = /^(a lot|much|way)$/.test(sizeWord) ? 2 : /^(a bit|a little|slightly|somewhat)$/.test(sizeWord) ? 0.5 : 1;
      const sign = /more/i.test(leaning[2]) ? 1 : -1;
      let clause = ` ${original.slice(leaning[0].length)} `;
      const objective = objectiveWords.find(([pattern]) => pattern.test(clause));
      if (objective) {
        const [pattern, key, permission] = objective;
        const value = Math.max(0, Math.min(1, Math.round(((objectives[key] ?? 0) + sign * size * 0.2) * 100) / 100));
        objectives[key] = value;
        if (permission && value > 0) permissions.add(permission);
        understood.push(`${sign > 0 ? 'More' : 'Less'} weight on ${objectiveNames[key]}`);
        clause = clause.replace(pattern, ' ');
        if (key !== 'diversity') ranks = true;
        if (!clause.replace(/[^\p{L}\p{N}@#]+/gu, '').length) continue;
      }
      const weight = sign * size * 0.5 > 1 ? 1 : sign * size * 0.5 < -1 ? -1 : sign * size * 0.5;
      for (const [pattern, kinds] of kindWords) {
        if (!new RegExp(pattern.source, 'i').test(clause)) continue;
        kinds.forEach((kind) => { if (sign > 0 && filters.hideKinds?.includes(kind)) restore({ kind }); addBoost({ kind }, weight); });
        clause = clause.replace(pattern, ' ');
      }
      for (const [pattern, source] of sourceWords) {
        if (!new RegExp(pattern.source, 'i').test(clause)) continue;
        if (sign > 0 && filters.hideSources?.includes(source)) restore({ source });
        addBoost({ source }, weight);
        clause = clause.replace(pattern, ' ');
      }
      for (const match of [...clause.matchAll(/@([a-z0-9_.-]{2,40})/gi)]) addBoost({ author: match[1].toLocaleLowerCase() }, weight);
      clause = clause.replace(/@[a-z0-9_.-]{2,40}/gi, ' ');
      const topics = clause.toLocaleLowerCase().replace(/[^\p{L}\p{N}#\s'-]/gu, ' ').split(/\s+/).map((word) => word.replace(/^['#-]+|['-]+$/g, '')).filter((word) => word.length > 1 && !filler.has(word) && !tuneFiller.has(word));
      for (const topic of unique(topics).slice(0, 5)) {
        if (sign > 0 && filters.mute?.includes(topic)) restore({ word: topic });
        addBoost({ topic }, weight);
      }
      continue;
    }
    if (again) {
      let clause = ` ${original.replace(/\b(?:again|unmute|bring\s+back|stop\s+hiding|show(?:\s+me)?|see)\b/gi, ' ')} `;
      let found = false;
      for (const [pattern, kinds] of kindWords) { if (new RegExp(pattern.source, 'i').test(clause)) { kinds.forEach((kind) => restore({ kind })); clause = clause.replace(pattern, ' '); found = true; } }
      for (const [pattern, source] of sourceWords) { if (new RegExp(pattern.source, 'i').test(clause)) { restore({ source }); clause = clause.replace(pattern, ' '); found = true; } }
      const tokens = clause.toLocaleLowerCase().replace(/[^\p{L}\p{N}@#\s_.-]/gu, ' ').split(/\s+/).filter((word) => word.length > 1 && !filler.has(word) && !tuneFiller.has(word));
      tokens.forEach((word) => restore({ word }));
      if (!found && !tokens.length) unused.push(original);
      continue;
    }
    // Anything else is a filter, written exactly as a new lens would write it, and added to this one.
    const draft = lensFromRequest(original);
    const added = draft.understood.filter((item) => item !== 'Newest first');
    if (!added.length) { unused.push(...(draft.unused.length ? draft.unused : [original])); continue; }
    const draftFilters = draft.lens.filters;
    for (const key of ['sources', 'kinds', 'about', 'hideSources', 'hideKinds', 'mute', 'muteAuthors'] as const) {
      if (draftFilters[key]) (filters as Record<string, string[]>)[key] = unique([...((filters[key] as string[] | undefined) ?? []), ...(draftFilters[key] as string[])]);
    }
    if (draftFilters.followedOnly) { filters.followedOnly = true; permissions.add('follows'); }
    if (draftFilters.maxAgeHours) filters.maxAgeHours = draftFilters.maxAgeHours;
    if (draft.lens.objectives.engagement && /popular|trending|liked|top posts/i.test(original)) { objectives.engagement = Math.max(objectives.engagement, draft.lens.objectives.engagement); permissions.add('public_engagement'); ranks = true; }
    understood.push(...added);
    unused.push(...draft.unused);
  }
  for (const key of Object.keys(filters) as (keyof LensFilters)[]) {
    const value = filters[key];
    if (Array.isArray(value) && !value.length) delete filters[key];
  }
  // Chronological order has no scores to lean, so leaning a newest-first lens ranks it by newness alone.
  if (ranks && order === 'newest' && !/Newest first/.test(understood.join(' '))) { order = 'ranked'; if (!rankingWeight(objectives)) objectives.recency = 1; understood.push('Ranked by newness so your changes apply'); }
  const copy = base.builtIn;
  const lens = parseLens({
    format: lensFormatV2,
    id: ownCopyId(base),
    name: copy ? `My ${base.name}`.slice(0, limits.name) : base.name,
    version: copy ? 1 : base.version + 1,
    description: copy ? `Your own copy of ${base.name}, tuned in your own words.` : base.description,
    permissions: [...permissions], filters, order, objectives, interests: base.interests, boosts,
    ...(copy ? { forkedFrom: base.id } : base.forkedFrom ? { forkedFrom: base.forkedFrom } : {}),
  });
  const after = describeLensRules(lens);
  const changes = [...after.filter((rule) => !before.includes(rule)).map((rule) => `Now: ${rule}`), ...before.filter((rule) => !after.includes(rule)).map((rule) => `No longer: ${rule}`)];
  return { lens, understood: unique(understood), unused: unique(unused), changes };
}

const tuneFiller = new Set(['lot', 'bit', 'little', 'much', 'way', 'slightly', 'somewhat', 'than', 'stuff', 'please', 'again', 'tune', 'adjust', 'weight', 'there', 'here', 'feed']);

// ---------- helpers ----------

function object(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new LensError(message);
  return value as Record<string, unknown>;
}

function allowOnly(value: Record<string, unknown>, keys: string[], where: string) {
  const extra = Object.keys(value).filter((key) => !keys.includes(key));
  if (extra.length) throw new LensError(`Unknown ${where} field${extra.length === 1 ? '' : 's'}: ${extra.join(', ')}. A lens can only use the signals in its format.`);
}

function text(value: unknown, max: number, where: string): string {
  if (typeof value !== 'string') throw new LensError(`${where} must be text.`);
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function list<T extends string>(value: unknown, allowed: readonly T[], where: string): T[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new LensError(`${where} must be a list.`);
  const bad = value.filter((item) => !allowed.includes(item as T));
  if (bad.length) throw new LensError(`${where} can only contain ${allowed.join(', ')}.`);
  return unique(value as T[]);
}

function words(value: unknown, where: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > limits.words) throw new LensError(`${where} must be a list of up to ${limits.words} words.`);
  return unique(value.map((item) => text(item, limits.word, where).toLocaleLowerCase()).filter(Boolean));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function slug(value: string) {
  return value.toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lens';
}

function capitalize(value: string) {
  return value ? value[0].toLocaleUpperCase() + value.slice(1) : value;
}

function postedLabel(ageMs: number) {
  const minutes = Math.max(0, Math.round(ageMs / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function ageLabel(hours: number) {
  if (hours % 24 === 0) return hours === 24 ? '24 hours' : hours === 168 ? '7 days' : `${hours / 24} days`;
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

const sourceLabels: Record<LensSource, string> = { 'open-media': 'Open Media', farcaster: 'Farcaster', lens: 'Lens', hive: 'Hive', deso: 'DeSo', events: 'public event listings' };

function sourceName(source: string): string {
  return sourceLabels[source as LensSource] ?? source;
}

const kindLabels: Record<LensKind, string> = { text: 'text posts', image: 'images', video: 'videos', product: 'products', service: 'services', event: 'events', job: 'job posts' };

function listKinds(kinds: LensKind[]) {
  return joinWords(kinds.map((kind) => kindLabels[kind]));
}

function listNames(sources: LensSource[]) {
  return joinWords(sources.map(sourceName));
}

function joinWords(items: string[]) {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items[items.length - 1]}`;
}

// ---------- Share links ----------

export const lensShareOrigin = 'https://openmedia.site';

/** A link that opens Open Media with a lens: built-ins by name, shared lenses by id. */
export function lensShareUrl(id: string, origin = lensShareOrigin): string {
  return `${origin.replace(/\/$/, '')}/?lens=${encodeURIComponent(id)}`;
}

/** The lens id in a share link, if it carries a valid one. */
export function lensIdFromUrl(url: string): string | undefined {
  const match = url.match(/[?&]lens=([^&#]+)/);
  const id = match ? decodeURIComponent(match[1]) : '';
  return /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) ? id : undefined;
}
