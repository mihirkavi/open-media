# ADR 0019: Profile fields with per-field privacy, Edit profile, and /@handle addresses

- Status: **accepted, built 2026-10-28, deployed 2026-10-29** (Worker `e3e1dc99`). Verified on the web; iOS and Android not yet tested.
- Builds on: [ADR 0018](0018-work-lens-professional-profiles.md) (professional profiles and resumes), [ADR 0013](0013-identity-contacts-commerce-payments.md) (profiles, follows, contacts)

## Context

On 2026-10-28 the owner could not find their resume and asked for:

1. a way to fill in the whole profile, with every field, including their accounts on other social networks;
2. details that stay private, deciding what people see when the owner shows up in their contacts;
3. a simple public address such as openmedia.site/@mihirkavishwar.

The resume could not be found because it existed only at an API address and returned a JSON error until the professional profile was filled in.

The owner chose (2026-10-28): one Edit profile screen (an explicit exception to the earlier no-new-buttons rule), a visibility choice on every field, and openmedia.site/@handle as the address.

## Decision

1. **Profile fields** (`src/domain/profileFields.ts`, table `public.profile_fields`):
   - Fields: pronouns, location, website, email, phone, and handles on LinkedIn, X, Instagram, Facebook, Threads, Bluesky, Mastodon, TikTok, YouTube, GitHub, Reddit, Medium, Substack, Dribbble, Behance, Twitch, Pinterest, Snapchat, Telegram and Discord.
   - Each field has a visibility: `everyone`, `connections` (mutual follows, or people the owner shares a conversation with) or `only_me`.
   - Email and phone start as `only_me`. Pasted profile links are reduced to the handle.
   - Rows are readable only by their owner and written only through `open_media_set_profile_fields`. `open_media_public_profile` returns each viewer only what they may see, so a private field never leaves the database.
   - Farcaster, Lens, Hive and DeSo stay in `linked_accounts`, which builds the timeline, and are always public.
2. **Edit profile** (`src/ui/EditProfile.tsx`):
   - It is one entry on the existing Profile screen and edits everything on one page: name, bio, headline, status, summary, skills, languages, experience, education, every profile field with its visibility, and the open-network accounts.
   - Search sentences and agents (`get_profile_fields`, `set_profile_fields`, `PUT /v1/me/profile-fields`) still change the same data.
3. **Addresses:**
   - `openmedia.site/@handle` opens the app on that profile, signed in or out, and opening any Open Media profile puts that address in the bar.
   - `openmedia.site/handle` redirects there, except for site pages and reserved words.
   - `openmedia.site/@handle/resume` (and `.json`, `.yaml`) is the resume. It includes only the profile fields the person shows to everyone.
   - Profiles show the address and a Resume link as text.
   - Before a resume exists, the page says so in Open Media's look instead of returning an API error.

## Consequences

- People control, per field, what strangers, connections and contacts see. The same rule applies to the app, the API, agents and the resume.
- Not built:
  - Profile photo upload: the app has no image storage yet.
  - Showing other networks' posts for the new accounts: only the four open networks feed the timeline.
  - Verifying that a listed account belongs to the person: accounts are declared and labelled as listed by the person.
