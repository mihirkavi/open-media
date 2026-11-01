# ADR 0020: Filling a profile from LinkedIn or the person's own website

- Status: **accepted, built and verified on the web locally** (2026-10-31). Not deployed. Migration `20261107120000_professional_projects.sql` is applied only to the local database. iOS and Android are not yet tested.
- Builds on: [ADR 0018](0018-work-lens-professional-profiles.md) (professional profiles, JSON Resume, LinkedIn CSV import), [ADR 0019](0019-profile-fields-and-addresses.md) (profile fields and Edit profile), [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents)
- Master builder prompt: LinkedIn only "where APIs and protocols permit"; never scrape; content-first UI. Owner rule: no new buttons.

## Context

The owner wants members to fill their Open Media profile from their LinkedIn resume and from their portfolio website, only with their consent, and wants agents to be able to do the same.

What was checked on 2026-10-31:

1. **LinkedIn's API still doesn't allow this.** Sign In with LinkedIn (OpenID Connect) returns a name, photo and email. Positions and education need `r_basicprofile` or the full profile, which LinkedIn grants only to approved partners. The Member Data Portability API returns a member's own data (positions, education, skills) to an app they authorize, but only for members in the EU/EEA and Switzerland, and the app needs LinkedIn's approval. LinkedIn's User Agreement §8.2 forbids scraping and automation. So the only route open to every member is the file LinkedIn gives them: the profile PDF ("Save to PDF") or the "Download your data" archive.
2. **ADR 0018 already reads the data-export CSVs** (`fromLinkedInExport`), but only through an agent tool, and it replaced the whole profile on save.
3. **Personal sites describe their owner in a few standard ways:** a JSON Resume at `/resume.json`, JSON-LD schema.org `Person`, the `h-card` microformat, Open Graph tags and `rel="me"` links. Reading a site the person names is a server-side fetch, so it needs SSRF protection.

## Decision

### 1. Every import returns proposals, and the person chooses

`src/domain/profileImport.ts` defines a **proposal**: `{ id, label, value, preview, source }`, one per field (name, bio, headline, summary, location, experience, education, skills, languages, links, projects, or a profile field such as `field:website` or `field:github`). Each reader returns proposals and saves nothing. `applyProposals` merges the chosen ones into what the person already has: text fields are replaced, while skills, languages, links, experience, education and projects are added to, without duplicates. The result is checked by `parseProfessional`, the same check as any other save.

### 2. LinkedIn: the person's own file only

- **Profile PDF** (`src/domain/linkedInPdf.ts`). The Worker takes the text out with [unpdf](https://github.com/unjs/unpdf) 1.9.0 (MIT, the serverless build of Mozilla's PDF.js, pinned to a release more than two weeks old). It keeps each line's font size, so the name is the largest text. The parser follows LinkedIn's fixed layout: the side column (Contact, Top Skills, Languages, Certifications), then the name, headline and place, then Summary, Experience (including several roles under one company) and Education. In Contact it keeps only the LinkedIn address and the person's own sites, which become the LinkedIn and Website fields. Email addresses and phone numbers are skipped. Files must be PDFs of 2 MB or less, and the file is not stored.
- **Data export.** The existing CSV reader, now returning proposals. In the web app the person can pick the archive itself. The browser unzips only Profile, Positions, Education, Skills and Languages CSVs with its own `DecompressionStream`, so messages and connections never leave the device. Phones ask for the CSV files instead (the Files app unzips the archive).
- Open Media never reads linkedin.com. `import_portfolio` refuses linkedin.com addresses.

### 3. The person's website, read politely

`services/mail-sync/src/profileImport.ts` reads a site only after the person asks for it in Edit profile, or when an agent passes `consent: true` after asking them:

- User agent `OpenMediaProfileReader/1.0 (+https://openmedia.site/docs/profile-import)`. It reads robots.txt first and obeys it under RFC 9309 rules: the group naming the reader, else `*`; the longest rule wins, with Allow winning ties, and `*` and `$` wildcards apply.
- SSRF guard: only https on port 443, with no user name or password in the address. Every address the host resolves to must be public, and this is checked again after each of at most three redirects (`fetchPublicPage` and `isPublicAddress`, shared with listing checks). Bare IPs, `localhost`, `.local` and `.internal` are refused. Cloudflare's egress cannot reach private networks either.
- Caps: the given page plus up to three linked about, resume, CV or projects pages on the same host, plus `/resume.json`. Each request has a 1 MB limit (200 KB for the JSON) and an 8-second limit. Each person or IP gets a rate limit.
- `src/domain/portfolioExtract.ts` reads the HTML with a small, forgiving parser that runs nothing. Sources, best first: JSON Resume; JSON-LD Person (including a ProfilePage's `mainEntity`, with `jobTitle`, `worksFor`, `alumniOf`, `knowsAbout`, `knowsLanguage` and `sameAs`) and CreativeWork-type items as projects; h-card; Open Graph and meta tags and `rel="me"`; then headings such as Projects, Skills and About. Each field comes from the best source that has it and names that source. Only https links are kept. Social profile links become their profile fields, and the site's address becomes the Website field. Page content is data, so an instruction hidden in a page is never followed (a test checks this).
- Ownership is not proven. The person confirms that the site is theirs, and they review every value before it is saved.

### 4. Projects join the professional profile

`ProfessionalProfile.projects` (up to 10 entries of `{name, url?, description?}`, https only) follows JSON Resume's `projects`. It round-trips through `toJsonResume` and `fromJsonResume`, appears as a "Projects:" line on profiles, and is accepted by `app_private.valid_professional` (migration `20261107120000_professional_projects.sql`).

### 5. No new buttons: import lives inside Edit profile

Edit profile (the one profile screen, ADR 0019) gets:

- one plain line under its title: "Fill this in from *your LinkedIn PDF or data export* or *your website*." Both phrases are links in the text;
- "Fill my profile from this site" under the Website field once it holds an address, and a matching link under the LinkedIn field;
- a review card at the top listing each proposal with a check box, its value, what it would replace and its source, plus "Use N of M" and "Not now". Using them fills the form, and nothing is saved until the existing **Save profile**;
- a Projects section, edited like Experience.

### 6. Agents

- Account (`/me/mcp`): `import_resume` now accepts `linkedInPdf` (base64) and `linkedInPdfText` as well as `linkedInFiles` and `jsonResume`. New: `import_portfolio` (`url`, `consent`). Both return proposals; `save: true` with `accept: [ids]` saves only those ids and rejects unknown ones. REST: `POST /v1/me/professional/import` (body limit raised to 3 MB for the PDF) and `POST /v1/me/professional/portfolio`.
- Public and read-only: MCP `preview_profile_from_url` on `/open/mcp`, `GET /v1/profile-preview?url=`, and WebMCP `preview_open_media_profile_from_url`. WebMCP tools stay read-only, so saving is not offered there.
- The skill `open-media-work` (plugin 1.4.0) gives the steps and rules: the person's own file only, ask before reading a site, show every proposal with its source, and save only what they chose. The new page `/docs/profile-import` is linked from `llms.txt`, the API llms index and the agent guide.

## Consequences

- People can fill their profile in a minute from LinkedIn or their site, and they see where every value came from.
- No LinkedIn credentials, scraping or partner API are involved, and only the file the person picked is read.
- The PDF layout is LinkedIn's and may change. The parser then fails clearly ("doesn't look like LinkedIn's profile PDF") or proposes less, and the review step catches mistakes. A role listed right after several roles at one company may be put under that company; the person can fix it before saving.
- Sites without structured data give less. The docs tell people to publish `/resume.json` or a JSON-LD Person.
- Anyone can preview what a public site says about its owner (rate-limited, robots.txt obeyed, nothing stored). It reads only what the site already shows publicly.
- `expo-document-picker` 57.0.3 is a new native module. It needs no config plugin, but iOS and Android need a new build (prebuild and a TestFlight build) before the LinkedIn file option works there.
- Not built: the EEA Member Data Portability API (it needs LinkedIn's approval and business verification), proof of site ownership (for example a `rel="me"` link back to the Open Media profile), and reading PDF resumes other than LinkedIn's.
