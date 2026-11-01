# Test fixtures

Sample files for the profile-import tests (ADR 0020). They describe **Asha Rao**, a made-up person; every name, employer, school and address in them is fictional, and the domains end in `.example`.

- `linkedin-profile-sample.html` → `linkedin-profile-sample.pdf`: laid out like LinkedIn's "Save to PDF" profile file (side column first, then the main column). The PDF was printed from the HTML with headless Chrome (`--print-to-pdf`), so it has a real text layer for `unpdf` to read.
- `portfolio/`: a personal site with JSON-LD (schema.org Person), an h-card, Open Graph tags, rel="me" links, Projects and Skills headings and a `/resume.json`. It also hides an instruction in an HTML comment to check that page text is treated as data.

`npm run local` serves `portfolio/` at http://127.0.0.1:8095 so the import can be tried in the app. Never add a real person's export or site here.
