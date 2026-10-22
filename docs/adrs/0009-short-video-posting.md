# ADR 0009: Short-video posting and cross-posting

- Status: accepted
- Date: 2026-10-21

## Context

Clips (ADR 0008) showed only other networks' videos, because Open Media had nowhere to keep a video file. The builder prompt says Clips are "short-video posts viewed through an immersive vertical interface" over the canonical post (§7), that posting is "one tap → everywhere" (§10–11), that storage stays provider-agnostic and media is addressed by hash (§53), and that public content carries media references and hashes (§59). The owner asked for clips made in Open Media to appear in Feed and Clips and to cross-post to every connected network by default.

Today Open Media has one Cloudflare Worker (`services/mail-sync`, which also serves the public API) and one Supabase project holding `public.posts`. The production Supabase project is paused; `npm run local` runs the full stack.

### Storage and transcoding options (October 2026)

| Option | What it does | Cost | Limits | Fit |
|---|---|---|---|---|
| **Supabase Storage** public bucket | Stores the uploaded file as is; served by URL through Supabase's CDN | Included storage and egress per plan, then per-GB | Free plan: 50 MB per file. Pro: configurable (we use 100 MB). No transcoding: viewers get the original file | Already part of the stack and of local development; works today with RLS on upload |
| **Cloudflare Stream** | Direct creator uploads, automatic transcoding to adaptive HLS/DASH, thumbnails | $5 per 1,000 minutes stored (prepaid), $1 per 1,000 minutes delivered; ingest and encoding free | 30 GB per file; `maxDurationSeconds` reserves storage until the upload finishes or the link expires | Best playback quality and bandwidth for phones; needs a Cloudflare account ID and API token on the Worker, and a "ready" state before a post plays |
| **Cloudflare R2** | Object storage, no transcoding | $0.015/GB-month, zero egress fees | 5 GB per single PUT | Cheaper than Supabase for large libraries, but still serves the original file; Stream is better for video |
| Network-native (Grove, Livepeer via DeSo, 3Speak) | Each network keeps its own copy | Network-specific | Grove: 125 MB per upload | Used for cross-posting, not as Open Media's primary copy |

A 3-minute 720p H.264 clip is roughly 40–70 MB; Open Media's limit is 100 MB, below Grove's 125 MB so the same cleaned file can go to Lens.

**Recommendation.** Ship with Supabase Storage now (implemented here), keep the database storing a *path plus SHA-256*, never a URL, and move playback to **Cloudflare Stream** before public launch: the Worker would issue one-time direct-upload URLs (`maxDurationSeconds: 180`), store the Stream UID as the post's video reference, and publish only after Stream reports `readyToStream`. At 1,000 posts of 1 minute each watched 50 times on average, Stream costs about $5 (storage) + $50 (delivery) per month, without separate egress. Because posts store a provider-neutral reference, Stream can be added as a second host (`video_host`) without rewriting existing posts. Stream is **not** implemented in this change.

### Privacy

Posts are public, so their videos are public too: anyone with the URL can download the file, and the public API lists it. Phones embed location and device details in video files (QuickTime `©xyz` in `moov/udta`, `com.apple.quicktime.location.ISO6709` in `moov/meta`, XMP packets). Re-encoding (Stream, or a phone's export) usually drops them, but the original file is what Supabase serves, so Open Media removes them on the device before upload.

## Decision

**Canonical post.** A post carries at most one video. `public.posts` gains `video_path`, `video_poster_path`, `video_duration_seconds` (≤ 180), `video_width`, `video_height`, `video_content_type` (MP4, MOV, WebM), and `video_sha256`. A video post may have no text. `open_media_create_post(client_id, body, video)` accepts the video only if the file already exists in the `post-videos` bucket, was uploaded by the same author into their own folder, and isn't attached to another post. Constraints enforce the limits even for direct inserts. RLS is unchanged: authors read their own rows; everyone else reads through the security-definer public projection, which now includes `video` (paths, dimensions, duration, type, hash). `open_media_public_posts` gains `p_media = 'video'` so Clips pages through video posts only. `PostMedia` gains an optional `sha256`.

**Storage.** A public Supabase Storage bucket, `post-videos`, limited to 100 MB and to `video/mp4`, `video/quicktime`, `video/webm`, and `image/jpeg` (posters). Authors may write only under `<their user id>/`. Files are named `<user id>/<post client id>.<ext>`, so a retried upload replaces the same object. Deleting a post deletes its files.

**On the device, before anything is uploaded** (`src/domain/postVideo.ts`, `src/data/videoUpload.ts`):

1. The picker limits recording to 3 minutes where the platform allows; the composer rejects files over 3 minutes or 100 MB, and non-video files, with a specific reason.
2. The container is identified from the bytes, not the file name.
3. Every `udta` and `meta` box and the XMP `uuid` box in an MP4/MOV is zeroed and renamed to `free`. Sizes and chunk offsets don't change, so audio and video are untouched and no re-encode is needed. Browser recordings (WebM) carry no location.
4. The SHA-256 of the cleaned bytes is recorded with the post. It is computed by the author's device; the server doesn't re-hash the stored file, so it records what the uploader claimed, and a mismatch would show tampering only when someone checks.
5. On web, the duration, dimensions, and a 720-pixel JPEG poster are read from the cleaned file. On iOS and Android, duration and size come from the picker; no poster is made yet.

**Composer.** A film button picks a video (and a camera button records one on iOS and Android). The composer shows the clip, its length and size, and "Location and device details removed". Publishing shows each stage: uploading (with a percentage bar and a Stop upload button), publishing to Open Media, then sending to other networks. The Open Media post is always created first, and only after the upload completes. The destination list shows, per network, why a video can't go there or how it will arrive. After publishing, each network's result is listed (posted, skipped, or failed, with the reason); Try again resends only failed networks and never double-posts.

**Cross-posting per network** (delegated keys only, as in ADR 0007):

| Network | How the video is sent | When it is skipped |
|---|---|---|
| Lens | The cleaned file is uploaded to Grove (immutable, ≤ 125 MB), then posted as `posts/video/3.0.0` metadata with `mainContentFocus: SHORT_VIDEO`, duration, alt text, and the poster as cover when public | Never for size (Open Media's limit is lower); only if neither the file nor a public URL is available |
| Farcaster | The cast embeds Open Media's public video URL (casts can't carry files; embed URLs ≤ 256 bytes). A cast may have no text | When the video URL isn't publicly reachable (for example a local development stack) |
| DeSo | The cleaned file goes to DeSo's media API (`uploadVideo`, stored with Livepeer); the post's `VideoURLs` is the returned `lvpr.tv` link | If the file isn't available on this device |
| Hive | No native video, so the post is markdown: the caption, the poster image linking to the video, and a "Watch the video" link. Tagged `video`, with `links`/`image` in `json_metadata` | When the video URL isn't publicly reachable |

A 3Speak upload for Hive was rejected for now: it needs a separate 3Speak account session and its upload API is not documented as public.

## Consequences

- A clip made in Open Media plays in Feed and Clips, appears in the public API (`video.url`, `posterUrl`, `durationSeconds`, `sha256`; `?media=video` filters), and is offered to every connected network by default.
- Viewers get the original file, not adaptive streaming, until Cloudflare Stream is added. Large files will start slowly on mobile data.
- Location metadata is removed only from MP4/MOV container boxes Open Media knows about. Location burned into the picture (a street sign) or spoken aloud is not detected.
- Lens and DeSo uploads hold the whole file in memory on the device; 100 MB is the practical ceiling.
- On a local stack the video URL is `http://127.0.0.1`, so Farcaster and Hive are skipped with an explanation; Lens and DeSo still work because they upload the file itself.
- Uploads that never become posts (publishing failed or was abandoned) stay in storage until a cleanup job exists.
- None of the four networks has received a video from Open Media in a live test; this change was verified with unit tests, database tests, and a local end-to-end run in the browser.
- iOS and Android need a new development build for `expo-image-picker` and `expo-file-system` and their camera, microphone, and photo-library permission strings.

## Review follow-ups (2026-10-21)

- **Published files are immutable.** Storage policy `Authors replace their own post videos` allows replacing a file only while no post references it (`app_private.post_video_in_use`), so upload retries still work but a published video can't be swapped for different content after people (or reviewers) have seen it. Authors can still delete their files. Covered by `open_media_post_videos_test.sql`.
- **Known gap: hidden posts keep a reachable file.** When a post is hidden by reports or removed by moderation (`removed_at`), it disappears from the app and API, but its video stays downloadable by anyone who already has the direct Storage URL, because the bucket is public and the row is kept for possible restoration. Moving playback to Cloudflare Stream with signed URLs, or a private bucket served through the Worker, closes this; until then, operator removal of abusive video must also delete the Storage object.

