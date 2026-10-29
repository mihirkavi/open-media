# ADR 0018: Work: professional profiles, jobs and the Work feed

- Status: **accepted and deployed** (built and verified on the web 2026-10-28; migration `20261101120000_work_profiles_and_jobs.sql` applied and Worker `4c66eaec` deployed the same day; iOS and Android not yet tested).
- Builds on: [ADR 0017](0017-feed-lenses.md) (lenses), [ADR 0016](0016-marketplace-trust-and-community-verification.md) (listing checks), [ADR 0013](0013-identity-contacts-commerce-payments.md) (listings), [ADR 0012](0012-agent-interfaces-and-design-system.md) and [ADR 0014](0014-agent-readiness-webmcp-and-plugin.md) (agents)
- Master builder prompt: LinkedIn only "where APIs and protocols permit" (§3, §11, §81); official APIs, never scraping; content-first UI.

## Context

The owner wants Open Media to also do what people use LinkedIn for: a professional profile, networking, finding jobs and applying, with AI that writes and tailors resumes and profiles. The owner's rule is that this adds no buttons or screens (feedback of 2026-10-26), and that agents can do everything.

Research on 2026-10-28 found:

1. **LinkedIn's official API gives very little.** Sign In with LinkedIn (OpenID Connect) returns only a name, photo and email. Share on LinkedIn (`w_member_social`) lets an app post as the member. Reading the feed, connections, full profile or jobs, and applying, is not available to ordinary apps. The full profile is available only through the member's own "Download your data" export, or the EEA-only Member Data Portability API, which needs business verification.
2. **LinkedIn's User Agreement (§8.2) bans bots, scraping and automation.** Popular "auto-apply" projects (AIHawk, whose repository now points to an anti-bot-evasion project; ApplyPilot; JobOps; JobSpy against LinkedIn or Indeed) drive a logged-in browser and risk the person's account. Open Media does not use or copy them.
3. **The safe open-source projects work with one open format, JSON Resume:** Reactive Resume (MIT, ~45k stars) imports JSON Resume and LinkedIn exports; Resume Matcher (Apache-2.0) tailors resumes; RenderCV (MIT) renders PDFs.
4. **Employer job-board APIs** (Greenhouse, Lever, Ashby, Workable) take applications only with the employer's own key. A candidate-side app can read public job lists and send people to the hosted form, nothing more.

## Decision

### 1. The Work lens is the "LinkedIn mode"

`workLens` is a third built-in lens (`src/domain/feedLenses.ts`): job posts and posts about hiring, careers, launches and professional events, ranked like Relevant (newness, who you follow, your topics). It reads nothing Relevant does not. It is opened by typing "work", "jobs", "networking", "professional" or "LinkedIn" in Search (`builtInLensFor`), and then takes the existing third place in the Feed switcher, so the switcher still has three choices. The database reserves the id `work`; anyone who had saved a lens called `work` keeps it under a new id.

### 2. A professional profile in JSON Resume form

`profiles.professional` holds a JSON Resume subset: headline, summary, open to work or hiring, location, work, education, skills, languages and https links (`src/domain/professionalProfile.ts`). It is public like the bio and is written only through `open_media_set_professional_profile`, which checks the shape again. It never holds a birth date, address, phone number or ID number; importing a LinkedIn export drops those columns.

- **Shown** as plain lines under the bio on both profile screens (`ProfessionalLines`).
- **Changed** by saying it in Search: "my headline is …", "I'm open to work", "we're hiring", "add skills …". One row shows the change and saving is choosing it. There is no form.
- **Imported** by an agent from a JSON Resume or the CSV files of LinkedIn's own data export (`import_resume`), saved only after the person agrees.
- **Exported** with "Export my data", which now also contains `jsonResume`.

### 2a. Resume tools are used, not rebuilt

At the owner's request, the drawing, rendering and formatting of resumes come from the open-source projects themselves rather than code of our own (`services/mail-sync/src/resumeFormats.ts`):

| Project | How Open Media uses it |
| --- | --- |
| [JSON Resume](https://jsonresume.org) (MIT) | The data format. `@jsonresume/schema` 1.3.1 checks every document Open Media produces. |
| `jsonresume-theme-even` 0.26.1 (MIT) | Draws the public resume page `GET /v1/profiles/{handle}/resume`, in Open Media's look: the theme's own colour variables are set to the app palette in `src/theme.ts` (light and dark), with Inter type and underlined rather than blue links. Its Google font and its scripts (which only add durations) are removed, and the page is served with a strict policy (no scripts, no outside requests). Application drafts link to it. |
| `@jsonresume/jsonresume-to-rendercv` 1.0.13 (MIT) | Makes `/resume.yaml`, the input for [RenderCV](https://github.com/rendercv/rendercv) (MIT), which typesets a PDF with `rendercv render`. |
| [Reactive Resume](https://github.com/reactive-resume/reactive-resume) v6 (MIT) | Imports `/resume.json` (format `JSON_RESUME`) through its own API or MCP server, with the person's own Reactive Resume connection, for an editable design and PDF export. The agent skill describes the steps; Open Media never stores a Reactive Resume key. |
| [Resume Matcher](https://github.com/srbhr/Resume-Matcher) (Apache-2.0) | Not wired in yet. It is a single-user app with no authentication that accepts only PDF or DOCX uploads, so it needs its own server behind an authenticating proxy and its own model key. Until the owner decides to host it, tailoring uses `careerAssist.ts` (below). |

Versions are pinned to releases at least two weeks old. All three npm packages were run in the Workers runtime (local workerd) before use.

### 3. Jobs are listings

A job is a listing of kind `job`: the price is the bottom of the pay range, and a job adds the top of the range, the kind of employment (read from the title: "intern", "contract", "part-time", "freelance") and an optional https link to the employer's own application page. Yearly pay has its own ceiling, above the sale-price one. In the composer there is no new choice: a listing whose title starts with "Hiring", "We're hiring" or "Job:" is a job, the way writing a start time already makes a listing an event, and the pay and apply-link fields take the place of the price and time. A job card keeps the one action every listing has: "Apply" opens the employer's link, or "Message the poster" when there is none. Job cards show no star ratings, and a job can never be paid for.

Job posts go through the ADR 0016 checks plus job rules (`jobScamRules`): asking applicants for a fee or deposit, or for ID numbers, bank details or one-time codes, holds the post; easy-money pay and "apply on Telegram/WhatsApp only" send it for a closer look. Salaries do not trigger the price or new-seller rules. Community verification asks whether the employer lists the role on its own careers page.

### 4. AI tailoring that can't invent experience

`services/mail-sync/src/careerAssist.ts` drafts, for one job, a headline, summary, skill order, job highlights and a short cover note, using Workers AI (Llama 3.3) with the job text treated as data. A check after the model removes any sentence with a number, employer or school the profile doesn't contain, and any skill the person didn't list, and returns the list of what it removed. Without AI it falls back to fixed rules that only reorder. Nothing is saved or sent: the person, or their agent with their approval, decides.

### 5. Applying uses what already exists

`draft_job_application` returns the message, who to send it to and the employer's link. It sends nothing. The agent sends it with `start_conversation` and `send_message` only after the person approves the exact text, or the person applies on the employer's page. Open Media never fills in forms on other sites and never applies in bulk.

### 6. Agents

- Public: `find_jobs` (MCP), `GET /v1/jobs`, WebMCP `find_open_media_jobs`.
- Public: `GET /v1/profiles/{handle}/resume` (and `.json`, `.yaml`).
- Account: `get_professional_profile` (with `jsonResume`, `renderCvYaml` and the resume links), `set_professional_profile`, `import_resume`, `tailor_resume`, `draft_job_application`, `publish_job`, and REST `/v1/me/professional`, `/v1/me/professional/import`, `/v1/me/career/tailor`, `/v1/me/career/application`.
- Skill `open-media-work` (plugin 1.3.0) carries the rules: facts only, never apply for anyone, never automate LinkedIn, keep private details off the public profile, warn about job scams.

### 7. LinkedIn itself

A connector entry "LinkedIn (official API)" is listed as planned, with the reasons. Phase 2, after the owner creates a LinkedIn developer app: Sign In with LinkedIn through Supabase's `linkedin_oidc` provider, and Share on LinkedIn as a cross-posting destination in the existing choices, with the token exchanged in the Worker (a client secret is needed) and stored on the device like other networks. The EEA portability API waits for business verification. Until then the LinkedIn import is the person's own data export.

## Consequences

- Open Media can be used for professional profiles, networking and hiring without new screens, and agents can do all of it.
- The professional profile is portable from day one (JSON Resume in, JSON Resume out).
- Open Media still can't read LinkedIn's feed, connections or jobs, or apply through LinkedIn; the docs and agent text say so.
- Jobs from external job boards are not shown. A later phase may read the public Greenhouse, Lever and Ashby job lists and hand off to their hosted forms.
- Not built: recruiter search, endorsements, verified employment (a future use of verifiable credentials or Open Badges 3.0), paid job posts.
