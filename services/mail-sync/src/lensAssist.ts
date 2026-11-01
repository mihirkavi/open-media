/**
 * The lens assistant (ADR 0020): a person talks to their Feed in plain words, in Search or through
 * any agent, and gets a lens back. It is a conversation: send the lens in use as `base` and the
 * request changes that lens ("also hide hive", "show hive again", "call it Calm") instead of
 * starting over.
 *
 * Fixed rules run first (src/domain/feedLenses.ts), so common requests give the same answer every
 * time, on the device, with no model. Only when the rules leave words they could not read does
 * Workers AI write the manifest, and what it writes is checked by the same validator as everything
 * else: it can only use the format's fields, cannot read anything a lens may not read, and is shown
 * to the person in plain rules before anything changes. Nothing is saved here.
 */
import {
  builtInLenses, describeLensRules, FeedLens, forbiddenSignals, lensFormat, lensFromRequest, LensError, lensKinds, lensPermissions, lensSources, parseLens, refineLens,
} from '../../../src/domain/feedLenses';

export interface LensAi { run(model: string, input: unknown): Promise<unknown> }
export const lensModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export interface LensAssistResult {
  lens: FeedLens;
  /** What was understood, in short phrases shown back to the person. */
  understood: string[];
  /** Words nothing could turn into a rule. */
  notUnderstood: string[];
  /** One sentence to show the person. */
  reply: string;
  /** Who wrote the lens: the fixed rules, or the AI model checked by the validator. */
  source: 'rules' | 'model';
  model?: string;
}

/** Plain words, optionally changing an existing lens, to a checked lens. */
export async function assistLens(input: { request: unknown; base?: unknown }, env: { AI?: LensAi }): Promise<LensAssistResult> {
  const request = typeof input.request === 'string' ? input.request.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  if (!request) throw new LensError('Describe the feed you want, e.g. “only videos about cooking, no crypto”.');
  const base = input.base === undefined || input.base === null || input.base === '' ? undefined : baseLens(input.base);
  const rules = base ? refineLens(base, request) : lensFromRequest(request);
  const result: LensAssistResult = { lens: rules.lens, understood: rules.understood, notUnderstood: rules.unused, reply: rulesReply(rules.lens, rules.understood, rules.unused, base), source: 'rules' };
  // The rules understood everything: no model needed, and the answer is the same every time.
  if (!rules.unused.length && rules.understood.length) return result;
  if (!env.AI) return result;
  try {
    const output = await env.AI.run(lensModel, { messages: lensPrompt(request, base ?? rules.lens, Boolean(base)), max_tokens: 700, temperature: 0.1 }) as { response?: unknown };
    const written = checkModelLens(output.response, base);
    if (!written) return result;
    return { lens: written.lens, understood: describeLensRules(written.lens), notUnderstood: [], reply: written.reply, source: 'model', model: lensModel };
  } catch {
    return result;
  }
}

function baseLens(value: unknown): FeedLens {
  if (typeof value === 'string') {
    const builtIn = builtInLenses.find((lens) => lens.id === value);
    if (builtIn) return builtIn;
    try { return parseLens(JSON.parse(value)); } catch { throw new LensError('base must be raw, relevant, work, or a lens manifest.'); }
  }
  const record = value as Record<string, unknown>;
  const builtIn = builtInLenses.find((lens) => lens.id === record?.id && record?.builtIn === true);
  return builtIn ?? parseLens(value);
}

function rulesReply(lens: FeedLens, understood: string[], unused: string[], base?: FeedLens): string {
  const what = understood.length ? understood.join(', ') : describeLensRules(lens).join(', ');
  const skipped = unused.length ? ` I couldn’t use: ${unused.join(', ')}.` : '';
  return `${base ? `Updated “${lens.name}”` : `“${lens.name}”`}: ${what}.${skipped}`;
}

/** The model's instructions: the format, the limits, and the request. */
export function lensPrompt(request: string, current: FeedLens, changing: boolean) {
  const { builtIn: _builtIn, author: _author, ...manifest } = current;
  return [
    {
      role: 'system',
      content: [
        'You write feed lenses for Open Media. A lens is a JSON manifest that filters and orders public posts. Reply with one JSON object only, no prose around it:',
        '{"name": string (max 40 chars), "permissions": [...], "filters": {...}, "order": "newest"|"ranked", "objectives": {...}, "interests": [...], "reply": string (one short sentence to the person saying what the feed now does)}',
        `permissions may contain only: ${lensPermissions.join(', ')}.`,
        `filters keys: sources and hideSources (from ${lensSources.join(', ')}), kinds and hideKinds (from ${lensKinds.join(', ')}), about and mute (up to 20 single lower-case words or hashtags), muteAuthors (handles), followedOnly (true needs the follows permission), maxAgeHours (1 to 2160).`,
        'objectives (each 0 to 1): recency, follows (needs follows), interests (needs interests), language (needs language), engagement (needs public_engagement), diversity.',
        'interests: up to 20 single words the lens should lift.',
        `No lens can read ${forbiddenSignals.join(', ').toLocaleLowerCase()}, or anything not listed above. If the person asks for something the format cannot express, leave it out and say so in reply.`,
        changing ? 'The person is changing the lens below. Keep everything they did not ask to change, including its name unless they renamed it.' : 'Start from the lens below, which fixed rules drafted from the same words, and fix what they missed.',
      ].join('\n'),
    },
    { role: 'user', content: `Current lens:\n${JSON.stringify(manifest)}\n\nRequest: ${request}` },
  ];
}

/** The model's answer, validated like any other manifest; anything invalid is dropped. */
export function checkModelLens(response: unknown, base?: FeedLens): { lens: FeedLens; reply: string } | undefined {
  const text = typeof response === 'string' ? response : response && typeof response === 'object' ? JSON.stringify(response) : '';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let value: Record<string, unknown>;
  try { value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>; } catch { return undefined; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const reply = typeof value.reply === 'string' ? value.reply.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  const { reply: _reply, id: _id, builtIn: _builtIn, author: _author, format: _format, version: _version, description: _description, ...rest } = value;
  try {
    const lens = parseLens({
      ...rest, format: lensFormat,
      id: base && !base.builtIn ? base.id : undefined,
      version: base && !base.builtIn ? base.version + 1 : 1,
      description: base && !base.builtIn ? base.description : 'Written with Open Media’s lens assistant.',
    });
    return { lens, reply: reply || `“${lens.name}”: ${describeLensRules(lens).join(', ')}.` };
  } catch {
    return undefined;
  }
}
