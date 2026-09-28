# ADR 0004: Public posts and an open read API

- Status: accepted
- Date: 2026-09-27

## Context

Open Media content was only visible after sign-in, and Feed/Clips used fictional in-memory posts. The product direction is that Open Media posts and profiles are open: anyone can read them without an account, and people, scrapers, and AI agents can consume them in a machine-readable form.

## Decision

- Every Open Media post is public. Profiles (handle, display name, bio, avatar, join date, post count) are public. Messages, imported email, contacts, blocks, and reports stay private.
- Posts are stored in `public.posts`. Anonymous callers get no table grants; they read only through `security definer` functions (`open_media_public_posts`, `open_media_public_post`, `open_media_public_profile`) that return an explicit JSON projection without email addresses or client IDs.
- Writes go through authenticated RPCs with validation, idempotent client IDs, and a 30-posts-per-hour limit. Authors can delete their own posts.
- Basic moderation: signed-in people can report a post (shared 20-per-day report limit). A post reported by three distinct people is hidden from all public reads and kept for operator review. `app_private.moderate_post` (service role only) removes or restores a post and closes its reports.
- Signed-out visitors land on the public feed and can read it without an account; publishing, reporting, and messaging require sign-in.
- `services/public-api` is a read-only Cloudflare Worker exposing a versioned JSON API (`/v1/posts`, `/v1/posts/{id}`, `/v1/profiles/{handle}`, `/v1/profiles/{handle}/posts`) with an OpenAPI 3.1 document, keyset pagination, permissive CORS, a crawl-allowing `robots.txt`, and per-IP rate limiting. It uses only the publishable key, so it cannot reach anything the public database functions do not already expose.

## Consequences

- Existing beta profiles become publicly readable once the migration is deployed. The composer, Profile, and sign-in screens state that posts and profiles are public.
- Deleted posts disappear from the app and the API immediately, but copies already fetched by third parties cannot be recalled. This is inherent to open publishing and is disclosed in the composer.
- There is no operator moderation console yet; removal and restoration are service-role database operations.
- Server-rendered HTML pages, feeds (RSS/Atom/JSON Feed), `llms.txt`, and ActivityPub federation are not implemented. The JSON API is the supported machine interface.
