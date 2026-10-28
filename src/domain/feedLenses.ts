// Only types come from posts.ts: posts.ts runs lenses, so a value import here would be circular.
import type { SocialPost } from './posts';

/**
 * Feed lenses (ADR 0017): every way of ordering the Feed, including the built-in Raw and Relevant,
 * is a small JSON manifest, never code. One runner here reads a manifest and orders posts the app or
 * an agent already loaded. A lens sees only the signals its manifest asks for, and the signals the
 * builder prompt forbids (private messages, exact location, sensitive traits, KYC documents,
 * emotional state) cannot be written in a manifest at all, so a shared lens cannot reach them.
 */

export const lensFormat = 'open-media.feed-lens/1';

export type LensSource = 'open-media' | 'farcaster' | 'lens' | 'hive' | 'deso' | 'events';
export type LensKind = 'text' | 'image' | 'video' | 'product' | 'service' | 'event';
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
}

export interface FeedLens {
  format: typeof lensFormat;
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
  /** The lens this one was copied from, when it was installed or forked from a shared lens. */
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
export const lensKinds: LensKind[] = ['text', 'image', 'video', 'product', 'service', 'event'];
export const lensPermissions: LensPermission[] = ['follows', 'interests', 'public_engagement'];

const noObjectives: LensObjectives = { recency: 0, follows: 0, interests: 0, engagement: 0, diversity: 0 };

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

export const builtInLenses: FeedLens[] = [relevantLens, rawLens];
const builtInIds = builtInLenses.map((lens) => lens.id);

/** Half-life of the recency objective: a post 12 hours old counts half as much as a new one. */
export const recencyHalfLifeHours = 12;

const limits = { name: 40, description: 280, word: 40, words: 20, id: 64, maxAgeHours: 24 * 90 };

export class LensError extends Error {}

/**
 * Checks a manifest from anywhere (an agent, a share link, the database) and returns a clean copy.
 * Unknown fields are refused rather than ignored, so a manifest cannot smuggle in a signal.
 */
export function parseLens(value: unknown): FeedLens {
  const input = object(value, 'A lens must be a JSON object.');
  allowOnly(input, ['format', 'id', 'name', 'version', 'description', 'author', 'builtIn', 'permissions', 'filters', 'order', 'objectives', 'interests', 'forkedFrom', 'forbidden'], 'lens');
  if (input.format !== undefined && input.format !== lensFormat) throw new LensError(`Unknown lens format. Use "${lensFormat}".`);
  const name = text(input.name, limits.name, 'name');
  if (!name) throw new LensError('A lens needs a name.');
  const derived = slug(name);
  const id = input.id === undefined ? (builtInIds.includes(derived) ? `${derived}-lens` : derived) : text(input.id, limits.id, 'id');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) throw new LensError('A lens id may use letters, digits, - and _ only.');
  // Only Open Media's own two lenses are built in; a manifest cannot claim to be one or take its id.
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
  allowOnly(objectivesInput, Object.keys(noObjectives), 'objectives');
  const objectives = { ...noObjectives };
  for (const key of Object.keys(noObjectives) as (keyof LensObjectives)[]) {
    if (objectivesInput[key] === undefined) continue;
    const weight = Number(objectivesInput[key]);
    if (!Number.isFinite(weight) || weight < 0 || weight > 1) throw new LensError(`objectives.${key} must be between 0 and 1.`);
    objectives[key] = Math.round(weight * 100) / 100;
  }
  if (order === 'ranked' && objectives.recency + objectives.follows + objectives.interests + objectives.engagement === 0) objectives.recency = 1;
  const needs: [boolean, LensPermission, string][] = [
    [Boolean(filters.followedOnly) || objectives.follows > 0, 'follows', 'who you follow'],
    [objectives.interests > 0, 'interests', 'your interests'],
    [objectives.engagement > 0, 'public_engagement', 'public like and repost counts'],
  ];
  for (const [needed, permission, label] of needs) {
    if (needed && !permissions.includes(permission)) throw new LensError(`This lens uses ${label}, so permissions must include "${permission}".`);
  }
  const lens: FeedLens = {
    format: lensFormat, id, name,
    version: input.version === undefined ? 1 : Math.max(1, Math.min(10_000, Math.floor(Number(input.version)) || 1)),
    description: text(input.description ?? '', limits.description, 'description'),
    permissions, filters, order, objectives,
    interests: words(input.interests, 'interests'),
  };
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
  if (!kinds.length) kinds.push('text');
  return kinds;
}

/** Which of the given words or hashtags a post mentions, as whole words in its title, text or topics. */
export function matchingTopics(post: SocialPost, topics: string[]): string[] {
  if (!topics.length) return [];
  const haystack = ` ${[post.title ?? '', post.body, post.listing?.title ?? '', post.event?.title ?? '', ...post.topics].join(' ').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ')} `;
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
  };
}

export function lensScore(post: SocialPost, lens: FeedLens, context: LensContext = {}): number {
  const signals = permittedSignals(lens, context);
  const values = objectiveValues(post, signals);
  const { objectives } = lens;
  const engagement = lens.permissions.includes('public_engagement') ? objectives.engagement : 0;
  const total = objectives.recency + objectives.follows + objectives.interests + engagement || 1;
  return (values.recency * objectives.recency + values.follows * objectives.follows + values.interests * objectives.interests + values.engagement * engagement) / total;
}

/** Orders posts through a lens: filters first, then newest first or by score with authors spread out. */
export function runLens(posts: SocialPost[], lens: FeedLens, context: LensContext = {}): SocialPost[] {
  const kept = posts.filter((post) => lensKeeps(post, lens, context).kept);
  if (lens.order === 'newest') return kept.sort(newestFirst);
  const scored = kept.map((post) => ({ post, score: lensScore(post, lens, context) })).sort((a, b) => b.score - a.score || newestFirst(a.post, b.post));
  const diversity = lens.objectives.diversity;
  if (!diversity) return scored.map((item) => item.post);
  // Greedy re-rank: each post already shown from the same author (and, more lightly, the same
  // network) lowers the next one's score, so the Feed alternates voices without hiding anyone.
  const authorSeen = new Map<string, number>();
  const sourceSeen = new Map<string, number>();
  const ordered: SocialPost[] = [];
  const remaining = [...scored];
  while (remaining.length) {
    let best = 0;
    let bestScore = -Infinity;
    // Looking ahead a bounded window keeps this fast on long feeds; scores only fall further down.
    for (let index = 0; index < Math.min(remaining.length, 40); index += 1) {
      const { post, score } = remaining[index];
      const adjusted = score * Math.pow(1 - diversity * 0.5, authorSeen.get(post.author.id) ?? 0) * Math.pow(1 - diversity * 0.15, sourceSeen.get(post.provenance.connectorId) ?? 0);
      if (adjusted > bestScore) { best = index; bestScore = adjusted; }
    }
    const [{ post }] = remaining.splice(best, 1);
    ordered.push(post);
    authorSeen.set(post.author.id, (authorSeen.get(post.author.id) ?? 0) + 1);
    sourceSeen.set(post.provenance.connectorId, (sourceSeen.get(post.provenance.connectorId) ?? 0) + 1);
  }
  return ordered;
}

export interface LensExplanation {
  /** Signals this lens used for this post. */
  used: string[];
  /** The lens's own rules that this post passed. */
  rules: string[];
  /** What the lens is allowed to read but did not, and what no lens can read. */
  notUsed: string[];
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
  return { used, rules: describeLensRules(lens), notUsed };
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
    const parts: [number, string][] = [[objectives.recency, 'newness'], [objectives.follows, 'who you follow'], [objectives.interests, lens.interests.length ? `topics (${lens.interests.join(', ')})` : 'your topics'], [objectives.engagement, 'public likes and reposts']];
    const total = parts.reduce((sum, [weight]) => sum + weight, 0) || 1;
    rules.push(`Ranked by ${parts.filter(([weight]) => weight > 0).map(([weight, label]) => `${label} ${Math.round((weight / total) * 100)}%`).join(', ')}`);
    if (objectives.diversity) rules.push('Spreads authors and networks out');
  }
  return rules;
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
  const kind = filters.kinds?.length === 1 ? { text: 'Text', image: 'Images', video: 'Videos', product: 'Products', service: 'Services', event: 'Events' }[filters.kinds[0]] : undefined;
  const parts = [filters.followedOnly ? 'Following' : '', topic ? capitalize(topic) : '', kind ?? ''].filter(Boolean);
  if (!parts.length && filters.sources?.length === 1) parts.push(sourceName(filters.sources[0]));
  if (!parts.length && (filters.mute || filters.hideKinds || filters.hideSources)) parts.push('Quiet');
  return (parts.join(' ') || 'My feed').slice(0, limits.name);
}

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

const kindLabels: Record<LensKind, string> = { text: 'text posts', image: 'images', video: 'videos', product: 'products', service: 'services', event: 'events' };

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
