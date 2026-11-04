import { MessageReaction } from './models';

/** The quick reactions offered on every message, like iMessage tapbacks. */
export const tapbacks = ['❤️', '👍', '👎', '😂', '‼️', '❓'] as const;

const tapbackWords: Record<string, string> = {
  '❤️': 'Loved',
  '👍': 'Liked',
  '👎': 'Disliked',
  '😂': 'Laughed at',
  '‼️': 'Emphasized',
  '❓': 'Questioned',
};

/** One emoji, never words or links: what the database accepts too. */
export function isReactionEmoji(value: string): boolean {
  const emoji = value.trim();
  return emoji.length > 0 && emoji.length <= 16 && !/[\p{L}\p{N}\s<>/\\:.]/u.test(emoji) && /\p{Extended_Pictographic}|[‼❓]/u.test(emoji);
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  /** Whether one of them is the signed-in person's. */
  mine: boolean;
  /** Who reacted; the signed-in person, when among them, is last. */
  personIds: string[];
}

/** Reactions grouped by emoji, oldest emoji first, so badges don't jump around as more arrive. */
export function summarizeReactions(reactions: MessageReaction[] = []): ReactionSummary[] {
  const byEmoji = new Map<string, ReactionSummary & { first: number }>();
  for (const reaction of reactions) {
    const at = Date.parse(reaction.at) || 0;
    const entry = byEmoji.get(reaction.emoji);
    if (entry) {
      entry.count += 1;
      entry.mine ||= reaction.mine;
      if (reaction.mine) entry.personIds.push(reaction.personId);
      else entry.personIds.splice(entry.mine ? entry.personIds.length - 1 : entry.personIds.length, 0, reaction.personId);
      entry.first = Math.min(entry.first, at);
    } else {
      byEmoji.set(reaction.emoji, { emoji: reaction.emoji, count: 1, mine: reaction.mine, personIds: [reaction.personId], first: at });
    }
  }
  return [...byEmoji.values()].sort((a, b) => a.first - b.first).map(({ first: _first, ...summary }) => summary);
}

/** The signed-in person's reaction on a message, if any. */
export function myReaction(reactions: MessageReaction[] = []): string | undefined {
  return reactions.find((reaction) => reaction.mine)?.emoji;
}

/**
 * The reactions after the signed-in person picks an emoji: it replaces theirs, or takes it off
 * when it is the one already there. Used to show the change before the server confirms it.
 */
export function applyMyReaction(reactions: MessageReaction[] = [], personId: string, emoji: string | undefined, at = new Date().toISOString()): MessageReaction[] {
  const current = myReaction(reactions);
  const others = reactions.filter((reaction) => !reaction.mine);
  if (!emoji || emoji === current) return others;
  return [...others, { emoji, personId, mine: true, at }];
}

/** "Ben loved this", "You and Ben liked this", "3 people reacted with 🔥". */
export function describeReaction(summary: ReactionSummary, nameOf: (personId: string) => string): string {
  const others = summary.personIds.slice(0, summary.mine ? summary.count - 1 : summary.count);
  const names = summary.count > 2 ? `${summary.count} people` : [...(summary.mine ? ['You'] : []), ...others.map(nameOf)].join(' and ');
  const word = tapbackWords[summary.emoji];
  return word ? `${names} ${word.toLowerCase()} this` : `${names} reacted with ${summary.emoji}`;
}
