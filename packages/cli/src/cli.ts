#!/usr/bin/env node
/**
 * open-media: the Open Media command line, for people and agents.
 *
 * Human-readable by default; --json prints the API's JSON for scripts and agents. Reads need no
 * key. Account commands use OPEN_MEDIA_TOKEN, or the session `open-media login` saved (renewed
 * automatically). Publishing needs --yes, so nothing is posted by accident. Exit codes: 0 done,
 * 1 the API refused or failed, 2 the command was wrong.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';

import { defaultBaseUrl, Network, OpenMedia, OpenMediaError, Post, Session } from '../../sdk/src/index';

const version = '0.1.0';
const networks: Network[] = ['open-media', 'farcaster', 'lens', 'hive', 'deso'];

const help = `open-media ${version}: Open Media from the command line

Usage: open-media <command> [options]

Read (no account needed)
  feed [--sources farcaster,lens] [--mode raw|relevant] [--clips]   The mixed feed
  search <words…>                                                  Search every network
  events [--query <words>] [--days <1-14>]                          Bay Area events
  profile <handle>                                                 An Open Media profile
  timeline <network> <handle>                                      One person's posts

Sign in (Open Media emails you a code; agents ask the person for it)
  login <email> [--code <code>]                                    Sign in or create an account
  logout                                                           Sign out and forget the session
  set-up-profile --name <name> --handle <handle>                   Name a new account
  token                                                            Print your access token (export OPEN_MEDIA_TOKEN=$(open-media token))

Your account (after login, or set OPEN_MEDIA_TOKEN)
  me                                                               Your profile
  post <text…> --yes                                               Publish a public post
  payments                                                         Your payments

Set up agents
  mcp-config [claude|codex]                                        MCP config for your agent

Options
  --json             Print JSON (for scripts and agents)
  --base-url <url>   API origin (default ${defaultBaseUrl}, or OPEN_MEDIA_BASE_URL)
  -h, --help         Show this help
  -v, --version      Show the version`;

class UsageError extends Error {}

function parse(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '-h') flags.help = true;
    else if (arg === '-v') flags.version = true;
    else if (arg.startsWith('--')) {
      const [key, inline] = arg.slice(2).split('=', 2);
      const takesValue = ['sources', 'mode', 'query', 'days', 'base-url', 'code', 'name', 'handle'].includes(key);
      flags[key] = inline ?? (takesValue ? argv[++index] ?? '' : true);
    } else positional.push(arg);
  }
  return { flags, positional };
}

function printPosts(posts: Post[]) {
  if (!posts.length) { console.log('No posts.'); return; }
  for (const post of posts) {
    console.log(`${post.author.name} (${post.author.handle}) · ${post.network} · ${post.createdAt}`);
    if (post.title) console.log(post.title);
    console.log(post.text.length > 400 ? `${post.text.slice(0, 400)}…` : post.text);
    if (post.url) console.log(post.url);
    if (post.why.used.length) console.log(`Why this: ${post.why.used.join('; ')}`);
    console.log('');
  }
}

function mcpConfig(target: string | undefined, baseUrl: string) {
  if (target === 'codex') {
    return `# ~/.codex/config.toml\n[mcp_servers.open-media]\nurl = "${baseUrl}/open/mcp"\n\n[mcp_servers.open-media-account]\nurl = "${baseUrl}/me/mcp"\nbearer_token_env_var = "OPEN_MEDIA_TOKEN"\n\n# Or install the plugin: codex plugin marketplace add mihirkavi/open-media`;
  }
  return JSON.stringify({
    mcpServers: {
      'open-media': { type: 'http', url: `${baseUrl}/open/mcp` },
      'open-media-account': { type: 'http', url: `${baseUrl}/me/mcp`, headers: { Authorization: 'Bearer ${OPEN_MEDIA_TOKEN}' } },
    },
  }, null, 2) + '\n\n// Or install the plugin: /plugin install open-media --marketplace mihirkavi/open-media';
}

// ─── The saved session (~/.config/open-media/session.json, readable only by you) ───

interface Saved extends Session { expires_at: number; base_url: string }

function sessionFile(env: Record<string, string | undefined>) {
  const dir = env.OPEN_MEDIA_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'open-media');
  return { dir, file: join(dir, 'session.json') };
}

function saveSession(env: Record<string, string | undefined>, session: Session, baseUrl: string) {
  const { dir, file } = sessionFile(env);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) + session.expires_in, base_url: baseUrl }), { mode: 0o600 });
  chmodSync(file, 0o600);
}

function loadSession(env: Record<string, string | undefined>, baseUrl: string): Saved | undefined {
  const { file } = sessionFile(env);
  if (!existsSync(file)) return undefined;
  try { const saved = JSON.parse(readFileSync(file, 'utf8')) as Saved; return saved.base_url === baseUrl ? saved : undefined; } catch { return undefined; }
}

/** OPEN_MEDIA_TOKEN wins; otherwise the saved session, renewed when it has under a minute left. */
async function accessToken(env: Record<string, string | undefined>, baseUrl: string): Promise<string | undefined> {
  if (env.OPEN_MEDIA_TOKEN) return env.OPEN_MEDIA_TOKEN;
  const saved = loadSession(env, baseUrl);
  if (!saved) return undefined;
  if (saved.expires_at - 60 > Date.now() / 1000) return saved.access_token;
  const renewed = await new OpenMedia({ baseUrl }).refreshSession(saved.refresh_token).catch(() => undefined);
  if (!renewed) return undefined;
  saveSession(env, renewed, baseUrl);
  return renewed.access_token;
}

async function askForCode(): Promise<string> {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await prompt.question('Code from the email: ')).trim(); } finally { prompt.close(); }
}

export async function run(argv: string[], env: Record<string, string | undefined> = process.env, input: { interactive?: boolean; ask?: () => Promise<string> } = {}): Promise<number> {
  const { flags, positional } = parse(argv);
  const [command, ...rest] = positional;
  if (flags.version) { console.log(version); return 0; }
  if (flags.help || !command) { console.log(help); return command || flags.help ? 0 : 2; }
  const baseUrl = String(flags['base-url'] || env.OPEN_MEDIA_BASE_URL || defaultBaseUrl).replace(/\/+$/, '');
  const signedIn = ['me', 'post', 'payments', 'set-up-profile', 'logout', 'token'].includes(command);
  const token = signedIn ? await accessToken(env, baseUrl) : env.OPEN_MEDIA_TOKEN;
  const client = new OpenMedia({ baseUrl, token, userAgent: `open-media-cli/${version}` });
  const out = (value: unknown, human: () => void) => { if (flags.json) console.log(JSON.stringify(value, null, 2)); else human(); };
  const needToken = () => { if (!token) throw new UsageError('Sign in first: open-media login you@example.com (or set OPEN_MEDIA_TOKEN).'); };

  try {
    switch (command) {
      case 'feed': {
        const sources = flags.sources ? String(flags.sources).split(',').map((item) => item.trim()) as Network[] : undefined;
        if (sources?.some((item) => !networks.includes(item))) throw new UsageError(`--sources takes: ${networks.join(', ')}`);
        if (flags.mode && flags.mode !== 'raw' && flags.mode !== 'relevant') throw new UsageError('--mode is raw or relevant');
        const page = await client.feed({ sources, mode: flags.mode as 'raw' | 'relevant' | undefined, kind: flags.clips ? 'clips' : 'feed' });
        out(page, () => { printPosts(page.data); if (page.unavailable.length) console.log(`Not loading right now: ${page.unavailable.join(', ')}`); });
        return 0;
      }
      case 'search': {
        if (!rest.length) throw new UsageError('search needs some words, e.g. open-media search ethereum on lens');
        const result = await client.search(rest.join(' ')) as { posts?: Post[]; data?: Post[] };
        out(result, () => printPosts(result.posts ?? result.data ?? []));
        return 0;
      }
      case 'events': {
        const days = flags.days ? Number(flags.days) : undefined;
        if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 14)) throw new UsageError('--days is a whole number from 1 to 14');
        const result = await client.events({ query: flags.query ? String(flags.query) : undefined, days }) as { area: string; data: { title: string; startsAt: string; place?: string; registrationUrl?: string }[] };
        out(result, () => {
          console.log(`Upcoming in ${result.area}:\n`);
          for (const event of result.data) console.log(`${event.startsAt}  ${event.title}${event.place ? ` · ${event.place}` : ''}\n  ${event.registrationUrl ?? ''}\n`);
        });
        return 0;
      }
      case 'profile': {
        if (!rest[0]) throw new UsageError('profile needs a handle');
        const result = await client.profile(rest[0]);
        out(result, () => console.log(JSON.stringify(result, null, 2)));
        return 0;
      }
      case 'timeline': {
        if (!networks.includes(rest[0] as Network) || !rest[1]) throw new UsageError(`timeline <network> <handle>; network is one of ${networks.join(', ')}`);
        const result = await client.timeline(rest[0] as Network, rest[1]) as { posts?: Post[]; data?: Post[] };
        out(result, () => printPosts(result.posts ?? result.data ?? []));
        return 0;
      }
      case 'me': {
        needToken();
        const result = await client.me();
        out(result, () => console.log(JSON.stringify(result, null, 2)));
        return 0;
      }
      case 'post': {
        needToken();
        const text = rest.join(' ').trim();
        if (!text) throw new UsageError('post needs the text to publish');
        if (!flags.yes) throw new UsageError(`This publishes a public post as you:\n\n  ${text}\n\nRun again with --yes to publish.`);
        const result = await client.publish(text);
        out(result, () => console.log(`Published: ${(result as { url?: string }).url ?? 'done'}`));
        return 0;
      }
      case 'payments': {
        needToken();
        const result = await client.payments();
        out(result, () => console.log(JSON.stringify(result, null, 2)));
        return 0;
      }
      case 'login': {
        const email = rest[0];
        if (!email || !email.includes('@')) throw new UsageError('login needs your email, e.g. open-media login you@example.com');
        let code = typeof flags.code === 'string' ? flags.code : '';
        if (!code) {
          await client.requestSignInCode(email);
          const interactive = input.interactive ?? Boolean(process.stdin.isTTY);
          if (!interactive) {
            out({ sent: true, email, next: `open-media login ${email} --code <code>` }, () => console.log(`Open Media emailed a sign-in code to ${email}.\nRun: open-media login ${email} --code <code>`));
            return 0;
          }
          console.log(`Open Media emailed a sign-in code to ${email}.`);
          code = await (input.ask ?? askForCode)();
        }
        const session = await client.signInWithCode(email, code);
        saveSession(env, session, baseUrl);
        const profile = await client.me().catch((error) => (error instanceof OpenMediaError && error.code === 'no_profile' ? undefined : Promise.reject(error)));
        out({ signedIn: true, user: session.user, profile: profile ?? null }, () => console.log(profile
          ? `Signed in as @${(profile as { handle: string }).handle}.`
          : `Signed in. This is a new account: open-media set-up-profile --name "Your name" --handle yourhandle`));
        return 0;
      }
      case 'token': {
        needToken();
        console.log(token);
        return 0;
      }
      case 'logout': {
        if (token) await client.signOut().catch(() => undefined);
        rmSync(sessionFile(env).file, { force: true });
        out({ signedOut: true }, () => console.log('Signed out.'));
        return 0;
      }
      case 'set-up-profile': {
        needToken();
        if (typeof flags.name !== 'string' || typeof flags.handle !== 'string') throw new UsageError('set-up-profile --name "Your name" --handle yourhandle');
        const profile = await client.setUpProfile(flags.name, flags.handle);
        out(profile, () => console.log(`Profile ready: @${(profile as { handle: string }).handle}`));
        return 0;
      }
      case 'mcp-config': {
        console.log(mcpConfig(rest[0], baseUrl));
        return 0;
      }
      default:
        throw new UsageError(`Unknown command “${command}”. Run open-media --help.`);
    }
  } catch (error) {
    if (error instanceof UsageError) { console.error(error.message); return 2; }
    if (error instanceof OpenMediaError) {
      if (flags.json) console.error(JSON.stringify({ error: { status: error.status, code: error.code, message: error.message } }));
      else console.error(`Open Media refused (${error.status} ${error.code}): ${error.message}`);
      return 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (process.argv[1] && /open-media|cli\.(js|ts)$/.test(process.argv[1])) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
