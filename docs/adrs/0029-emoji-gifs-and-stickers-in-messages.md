# ADR 0029: Emoji, GIFs and stickers in messages, from open sets

- Status: **accepted; built and verified on the web locally** (2026-11-03). GIF and animated-sticker search needs a `GIPHY_API_KEY` Worker secret, which the owner adds. The Worker with the `/v1/media/gifs` route is not deployed. iOS and Android are not tested.

## Context

The owner asked for multimedia in messages: "emojis and all the gifs, etc. stickers as well memoji and more". They asked to use the best-known open, publicly available sets, and for the design to be "really aesthetic".

Messages are text. They go through Open Media, Matrix, mautrix bridges (WhatsApp, Signal and others) and email, and none of those can take a new attachment type without per-network work. The [no-new-buttons rule](../../AGENTS.md) applies, but the owner asked for this picker by name, so it gets one control: a smile in the composer.

## Decision

### One picker, four tabs

The smile in the thread composer opens a panel above it with **Emoji · GIFs · Stickers · Me**. In Open Media AI's chat it shows only Emoji.

- An emoji goes in where the cursor is. A GIF or sticker sends as soon as you pick it, and anything you were typing stays in the box.
- On phones the panel takes the keyboard's place, and focusing the text box brings the keyboard back. On the web, Escape closes it.
- Recent emoji, skin tone and avatar look are kept on the device (AsyncStorage). They are never sent to a server.

### The sets

| Tab | Set | Licence | Served from | Why |
|---|---|---|---|---|
| Emoji | Unicode emoji. Names, keywords, groups and skin tones from **Emojibase 18** | MIT | Bundled (`src/domain/emojiCatalog.json`, about 100 KB) | Emojibase is the standard open emoji dataset. Only emoji up to version 15.1 are kept, so all of them draw in current system fonts |
| Stickers | **Microsoft Fluent Emoji**, 3D style (1,555) | MIT | jsDelivr, pinned to commit `1ffb34c…` | The best-known open 3D emoji art. Each 256 px PNG is about 40 KB |
| Stickers → Animated, GIFs | **GIPHY** | GIPHY API terms (attribution shown) | Searched through the Worker at `GET /v1/media/gifs?q=&kind=gifs\|stickers&offset=` | The standard GIF library. The key is a Worker secret |
| Me | **DiceBear Avataaars** (Pablo Stanley's Avataaars) | Free for personal and commercial use; DiceBear is MIT | `api.dicebear.com/9.x` | The closest open counterpart to Memoji: one look, 16 expressions |

Alternatives considered:

- **Google Noto Animated Emoji (CC BY 4.0).** It only comes at 512 px, 0.6–1.2 MB per sticker, which is too heavy for a picker grid.
- **Openverse (open GIF search).** Its search did not answer within 40 seconds.
- **Tenor.** It needs a Google key too, and GIPHY is more widely used.
- **Apple Memoji.** It is proprietary and has no public API.

### How media travels

A GIF or sticker is sent as **its link, alone in the message body**. This needs no schema change, works through every bridge and over email, and someone without Open Media still gets a link that opens. Open Media draws the link as the picture only when it matches one of these sets exactly (`parseMessageMedia`):

- **GIPHY:** `https://media.giphy.com/media/<id>/giphy.gif#<w>x<h>`. The fragment carries the size, so the frame keeps its shape before the GIF loads, and it never reaches a server.
- **Fluent:** the pinned jsDelivr commit only.
- **DiceBear:** `seed`, `eyes`, `mouth`, `eyebrows` and `size` only, with validated values.

Any other image link stays text. Otherwise a stranger could make your app load an image from a server they choose, which would reveal your address and the moment you read the message.

The avatar seed is random and stays on the device. It is never derived from an account id, so the link reveals nothing about you.

One to three emoji on their own are drawn large and without a bubble. GIFs sit in a rounded frame, and stickers stand without a bubble. In conversation lists and reply quotes, media reads as "GIF", "Sticker" or "Avatar sticker".

GIFs display through React Native's `Image`. It animates GIFs on the web and on iOS, and on Android through Fresco's GIF support, which Expo enables by default (`expo.gif.enabled`). No new native module was added.

### Privacy

GIF search sends only the typed words to GIPHY, from the Worker's address, rate-limited per IP. Viewing a GIF, sticker or avatar loads it from GIPHY's, jsDelivr's or DiceBear's CDN. Like any image on the web, that reveals the viewer's IP address to the CDN.

## Consequences

- To refresh the catalogs, run `npm run media:catalogs`. Bumping the Fluent commit there also needs `fluentCommit` changed in `src/domain/messageMedia.ts`. Links already sent stay on the old commit and keep loading.
- **Owner steps:**
  1. Create a GIPHY API key at developers.giphy.com.
  2. Add it to the Worker: `npx wrangler secret put GIPHY_API_KEY` in `services/mail-sync`. Locally, put `GIPHY_API_KEY=…` in `.env.local` before `npm run local`.
  3. Deploy.

  Until then the GIFs and Animated tabs say "aren't set up on this server yet". Emoji, Fluent stickers and avatar stickers work without a key.
- Not built: sending your own images as stickers, sticker packs from other people, and reactions with emoji. Messages from other networks show a GIF as a link unless it is one of the sets above.
