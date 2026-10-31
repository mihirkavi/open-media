// Renders the Open Media film (docs/film/film.html) to MP4, with its soundtrack (music.py).
// Everything is built in the operating system's temporary folder; only the finished files are
// copied back, to .github/assets/film/ and assets/landing/.
//
//   npm i --no-save --prefix "$TMPDIR/open-media-film-tools" playwright-core@1.56.1 ffmpeg-static@5.2.0
//   npx playwright@1.56.1 install chromium   (or point FILM_CHROME at any Chromium)
//   node docs/film/render.mjs            # the film, its website copy and the poster
//   FILM_GRAIN=0 node docs/film/render.mjs   # the README preview GIF
//   node docs/film/render.mjs stills 13,23.5,55   # single frames for review
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const work = join(tmpdir(), 'open-media-film');
const tools = createRequire(join(process.env.FILM_TOOLS ?? join(tmpdir(), 'open-media-film-tools'), 'node_modules', 'x.js'));
const { chromium } = tools('playwright-core');
const ffmpeg = tools('ffmpeg-static');
const run = (args) => { const r = spawnSync(ffmpeg, ['-v', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status) throw new Error(`ffmpeg failed: ${args.join(' ')}`); };

// 1. Assets: fonts, logos and the three phone screens cut from the real app screenshots.
const a = join(work, 'a');
mkdirSync(a, { recursive: true });
copyFileSync(join(here, 'film.html'), join(work, 'film.html'));
for (const file of ['logo-light.png', 'logo-dark.png']) copyFileSync(join(root, 'assets', 'brand', file), join(a, file));
const fonts = join(root, 'node_modules', '@expo-google-fonts');
for (const weight of ['400Regular', '500Medium', '600SemiBold', '700Bold', '800ExtraBold']) copyFileSync(join(fonts, 'inter', weight, `Inter_${weight}.ttf`), join(a, `Inter_${weight}.ttf`));
for (const style of ['400Regular', '400Regular_Italic']) copyFileSync(join(fonts, 'instrument-serif', style, `InstrumentSerif_${style}.ttf`), join(a, `InstrumentSerif_${style}.ttf`));
const trio = join(root, '.github', 'assets', 'screenshots', 'phone-trio.jpg');
[320, 962, 1606].forEach((x, i) => run(['-i', trio, '-vf', `crop=476:1036:${x}:82`, join(a, `phone${i + 1}.png`)]));

// 2. Frames, captured from a seekable page so every render is identical.
const [mode, times] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.FILM_CHROME || undefined, args: ['--allow-file-access-from-files', '--force-color-profile=srgb', '--font-render-hinting=none'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on('pageerror', (error) => console.error('page error:', error.message));
await page.goto('file://' + join(work, 'film.html') + (process.env.FILM_GRAIN === '0' ? '?grain=0' : ''));
await page.evaluate(() => window.ready);
if (mode === 'stills') {
  mkdirSync(join(work, 'stills'), { recursive: true });
  for (const t of times.split(',').map(Number)) {
    await page.evaluate((s) => window.seek(s), t);
    await page.screenshot({ path: join(work, 'stills', `t${t.toFixed(2)}.png`) });
  }
  await browser.close();
  console.log(`Stills in ${join(work, 'stills')}`);
  process.exit(0);
}
const fps = 30, seconds = 64, silent = join(work, 'silent.mp4');
const encoder = spawn(ffmpeg, ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-tune', 'film', '-pix_fmt', 'yuv420p', silent], { stdio: ['pipe', 'inherit', 'inherit'] });
for (let i = 0; i < fps * seconds; i++) {
  await page.evaluate((s) => window.seek(s), i / fps);
  if (!encoder.stdin.write(await page.screenshot({ type: 'png' }))) await new Promise((r) => encoder.stdin.once('drain', r));
  if (i % 300 === 0) console.log(`frame ${i} of ${fps * seconds}`);
}
encoder.stdin.end();
await new Promise((r) => encoder.on('close', r));
await browser.close();

// 3. Deliverables. A grain-free render (FILM_GRAIN=0) only makes the README preview, since grain
// bloats GIFs; a normal render makes the film, its copy for the website and the poster.
const film = join(root, '.github', 'assets', 'film');
mkdirSync(film, { recursive: true });
if (process.env.FILM_GRAIN === '0') {
  run(['-ss', '16', '-t', '18', '-i', silent, '-vf', 'fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle', join(film, 'preview.gif')]);
} else {
  const music = join(work, 'music.wav');
  if (spawnSync('python3', [join(here, 'music.py'), music], { stdio: 'inherit' }).status) throw new Error('music.py failed');
  run(['-i', silent, '-i', music, '-c:v', 'libx264', '-preset', 'slow', '-crf', '25', '-tune', 'film', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', join(film, 'open-media-film.mp4')]);
  copyFileSync(join(film, 'open-media-film.mp4'), join(root, 'assets', 'landing', 'film.mp4'));
  run(['-ss', '23.5', '-i', silent, '-frames:v', '1', '-vf', 'scale=1600:-1', '-q:v', '3', join(root, 'assets', 'landing', 'film-poster.jpg')]);
}
console.log('Wrote', readdirSync(film).join(', '));
