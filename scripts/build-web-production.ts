/**
 * Builds the production web app into .web-dist/, which the Worker serves at https://openmedia.site.
 * The app talks to the API at https://api.openmedia.site (override with OPEN_MEDIA_API_URL). The
 * Supabase URL and publishable key come from the environment or .env.local; both are public by
 * design and end up in the browser bundle, so nothing secret is read or written.
 * Run with `npm run build:web`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fromFile = (name: string) => {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return undefined;
  return readFileSync(file, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'))?.[1]?.trim();
};
const env = {
  EXPO_PUBLIC_OPEN_MEDIA_API_URL: process.env.OPEN_MEDIA_API_URL ?? 'https://api.openmedia.site',
  EXPO_PUBLIC_SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL ?? fromFile('EXPO_PUBLIC_SUPABASE_URL'),
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? fromFile('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY'),
  // Set SIGN_IN_EMAIL_CODES=1 once Supabase's send-email hook is on: Open Media's own emails
  // (services/mail-sync/src/authEmail.ts) carry a code as well as the link; Supabase's default ones don't.
  EXPO_PUBLIC_SIGN_IN_EMAIL_CODES: process.env.SIGN_IN_EMAIL_CODES === '1' ? '1' : '0',
};
if (!env.EXPO_PUBLIC_SUPABASE_URL?.startsWith('https://') || !env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
  throw new Error('Set EXPO_PUBLIC_SUPABASE_URL (https) and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, or keep them in .env.local.');
}
// Values in the process environment win over .env files, so local-only settings cannot leak in.
const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', '.web-dist', '--clear'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, ...env, NODE_ENV: 'production', EXPO_PUBLIC_LOCAL_AUTO_SIGN_IN: '' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
// The logos the sign-in emails show, served from openmedia.site/brand/.
mkdirSync(join(root, '.web-dist', 'brand'), { recursive: true });
for (const file of ['logo-light.png', 'logo-dark.png']) copyFileSync(join(root, 'assets', 'brand', file), join(root, '.web-dist', 'brand', file));
console.log(`Built .web-dist for ${env.EXPO_PUBLIC_OPEN_MEDIA_API_URL}`);
