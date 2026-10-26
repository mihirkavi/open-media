# README image sources

HTML pages that render the README's banner and terminal cards, at 2x, with Playwright.

- `banner.html`: the banner. `?theme=dark` gives the dark version. Uses the Instrument Serif and Inter fonts from `node_modules/@expo-google-fonts`, so run `npm install` first.
- `api-terminal.html` and `cli-terminal.html`: terminal cards holding real, trimmed command output, with the date it was captured in a comment.
- `render.mjs`: writes `banner-light.png`, `banner-dark.png`, `api-terminal.png` and `cli-terminal.png` to the parent folder.

Run `node .github/assets/source/render.mjs` from the repository root. It needs Playwright and a Chromium (`npx playwright install chromium`), or set `CHROME_PATH` to an installed Chrome. Playwright is not a project dependency; install it in a temporary folder if you do not have it.

Notes for agents: keep the colours in step with `src/theme.ts`, and refresh terminal output from the live API instead of inventing it.
