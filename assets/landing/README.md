# Landing page assets

Media for the web landing page (`src/ui/LandingPage.tsx`).

- `film.mp4`: the Open Media film (64 seconds, 1920×1080, with its soundtrack), played as the landing page's hero on the web by `src/ui/LandingFilm.web.tsx`. It is the same file as `.github/assets/film/open-media-film.mp4`.
- `film-poster.jpg`: a frame from the film (the "One feed." scene), shown before the film loads, for people who ask for reduced motion, and by `src/ui/LandingFilm.tsx` outside the web.
- `hero.jpg`: the desktop and phone composite of the real app (Feed, Clips and Messages), 1800 px wide. It is the same image as `.github/assets/hero.jpg`, resized.

Notes for agents: regenerate the film and its poster with `docs/film/render.mjs`, never by hand. Screenshots come from the running app, never mockups, and show only public posts or local test data.
