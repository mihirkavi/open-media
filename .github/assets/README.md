# README assets

Images used by the repository README and the package READMEs.

- `banner-light.png` and `banner-dark.png`: the banner at the top of the README, in Open Media's own type (Instrument Serif and Inter), shown by GitHub's light or dark theme.
- `logo-light.png` and `logo-dark.png`: the Open Media mark on a transparent background, for light and dark GitHub themes. Made from `assets/icon.png`.
- `hero.jpg`: the desktop and phone composite under the banner.
- `how-it-works.svg`: the "How it works" diagram.
- `api-terminal.png`: real public API output ("Why this?" over `curl` and `jq`), in the developers section.
- `cli-terminal.png`: real `open-media feed` output, in `packages/cli/README.md`.
- `screenshots/`: framed screenshots of the running app.
- `source/`: the HTML the banner and terminal cards are rendered from, and `render.mjs`.

Notes for agents: capture screenshots from the real app (`npm run local`) at 2x or 3x scale, show only public posts or local test data, and never include real messages, email or account details. Terminal cards must show real command output. After editing anything in `source/`, run `node .github/assets/source/render.mjs`. Package READMEs link these images by absolute `raw.githubusercontent.com` URL so they also render on npm and PyPI.
