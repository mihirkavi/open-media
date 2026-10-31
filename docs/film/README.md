# Film source

The source of the Open Media film: a 64-second, Apple-style piece about the mission (apps are doorways; the person is the constant) and the main features (one feed, feed lenses and "Why this?", one inbox, posting everywhere, Clips).

- `film.html`: the whole film as one seekable page. `window.seek(t)` draws the frame at `t` seconds, so a render is identical every time. It uses Inter and Instrument Serif, the app's own fonts, and real screenshots of the app from `.github/assets/screenshots/`.
- `music.py`: the original soundtrack, synthesised with numpy (120 BPM, timed to the cuts). No samples or licensed music.
- `render.mjs`: builds everything in the operating system's temporary folder, captures 1,920 frames with Playwright, adds the music with ffmpeg and writes `.github/assets/film/` and `assets/landing/film*`.

## Making the film

```bash
npm i --no-save --prefix "$TMPDIR/open-media-film-tools" playwright-core@1.56.1 ffmpeg-static@5.2.0
npx playwright@1.56.1 install chromium   # or set FILM_CHROME to any Chromium
node docs/film/render.mjs                    # the film, its web copy and the poster
FILM_GRAIN=0 node docs/film/render.mjs       # the README preview GIF needs a grain-free render
node docs/film/render.mjs stills 13,23.5,55  # single frames to review
```

Notes for agents: keep every claim in the film true to what works today (see "What works today" in the root README). Change the timeline in `film.html` and the cues in `music.py` together; both are in seconds.
