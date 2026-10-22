# ADR 0008: Clips from blockchain social networks

- Status: accepted
- Date: 2026-10-21

## Context

Clips showed fictional sample videos because Open Media has no video upload. The builder prompt defines Clips as "short-video posts viewed through an immersive vertical interface" over the same canonical posts as Feed, with no separate content store (ADR 0001). Feed already reads Farcaster, Lens, Hive, and DeSo (ADR 0006), but dropped their videos. The owner asked for Clips to work like the Feed: real content from these networks, continuous, and live.

We checked how each network publishes video (October 2026):

| Network | Video in the post | Playable source used |
|---|---|---|
| Lens | `VideoMetadata.video { item, cover, duration }` | MP4/MOV on Grove (`lens://` maps to `https://api.grove.storage/<hash>`), with byte ranges and open CORS |
| Farcaster | A cast embed `https://stream.farcaster.xyz/v1/video/<id>.m3u8` | HLS (redirects to Cloudflare Stream) |
| DeSo | `VideoURLs: ["https://lvpr.tv/?v=<id>"]` (a player page) | Livepeer's public playback API, `livepeer.studio/api/playback/<id>`, which lists MP4 renditions; we pick the one nearest 720p |
| Hive | `json_metadata.video.info { author, permlink, duration }` (3Speak) | 3Speak's player API, `play.3speak.tv/api/embed?v=author/permlink`, which returns the HLS stream. It is the same JSON its official embed player loads, not a documented public API |

## Decision

- Normalizers keep videos as `PostMedia { kind: 'video', url, streaming: 'hls' | 'progressive', posterUrl, durationSeconds }`. A post with a video has `kind: 'video'`, so the same post plays inline in Feed (tap to play, with sound) and appears in Clips.
- A clip is a video post of at most 3 minutes when the source reports a duration (`clipPosts`). Clips reads video-focused streams: Lens with `mainContentFocus: VIDEO/SHORT_VIDEO`, Hive's 3Speak community (`hive-181335`), DeSo posts with media, and video casts from the same Farcaster channels. The same published filters as Feed apply, and "Why this?" shows them.
- Clips reuses the Feed's continuous, live engine (`useMixedFeed(sessionKey, 'clips')`). Open Media's own posts are left out because they can't contain video yet.
- Interaction follows the familiar vertical short-video pattern: one clip per screen with snap paging, the visible clip autoplays muted (browsers allow muted autoplay only), there is a speaker button and tap to pause, and players are mounted only for the visible clip and its neighbours. More clips load three before the end.
- Nothing moves under a viewer. The first render waits for every network's first page (at most 3 s) so the opening order is newest-first. Later pages and slower networks merge newest-first below the clip being watched and the next one. New clips found by the 20-second check wait behind a "N new clips" pill and go on top only when tapped. (Feed inserts new posts automatically at the top; for video that would interrupt playback.)
- Playback: `expo-video` on iOS and Android (MP4/MOV and HLS), and a plain `<video>` on web. Safari and recent Chrome play HLS natively; `hls.js` is loaded on demand only where the browser can't. A clip that fails to play is removed from Clips, and a Feed video that fails disappears, leaving the "Open on …" link.

## Consequences

- Clips shows real, current short videos from four networks without accounts or keys.
- Posting clips is not possible: Open Media has no video upload, storage, or transcoding. Cross-posting (ADR 0007) is text-only.
- Hive video depends on 3Speak's undocumented player API and DeSo video on Livepeer's playback API. Either can change. A failure only removes those clips.
- `expo-video` is a native module, so iOS and Android need a new development build.
- Farcaster has no video-only query, so Farcaster clips come from scanning recent casts in four channels, and there are relatively few of them.
