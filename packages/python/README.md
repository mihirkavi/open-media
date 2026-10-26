<p align="center">
  <a href="https://github.com/mihirkavi/open-media">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/mihirkavi/open-media/main/.github/assets/logo-dark.png">
      <img alt="Open Media" src="https://raw.githubusercontent.com/mihirkavi/open-media/main/.github/assets/logo-light.png" width="64">
    </picture>
  </a>
</p>

<h1 align="center">open-media for Python</h1>

<p align="center">
  <strong>The official Python client for the Open Media API.</strong><br>
  One feed and one search across Open Media, Farcaster, Lens, Hive and DeSo. No dependencies; Python 3.9+.
</p>

<p align="center">
  <a href="https://api.openmedia.site/docs">API docs</a> ·
  <a href="../sdk">TypeScript SDK</a> ·
  <a href="https://github.com/mihirkavi/open-media">Open Media</a>
</p>

## Install

> [!NOTE]
> The client is not on PyPI yet. Until it is, install it from this repository:
>
> ```bash
> git clone https://github.com/mihirkavi/open-media.git
> pip install ./open-media/packages/python
> ```
>
> Once published, it will be `pip install open-media`.

## Quick start

```python
from open_media import OpenMedia

om = OpenMedia()
for post in om.feed(sources=["farcaster", "lens"], mode="raw")["data"]:
    print(post["network"], post["author"]["handle"], post["text"], post["url"])

results = om.search("videos about cooking today")
events = om.events(query="ai founders", days=7)
```

## Acting for a person

Acting for a person needs their own token (in the app: **Settings → Developers and agents**). Every call acts only as them.

```python
import os
from open_media import OpenMedia

me = OpenMedia(token=os.environ["OPEN_MEDIA_TOKEN"])
me.publish("Hello from my agent")
```

## Good to know

- Writes send an `Idempotency-Key` automatically, so retries are safe.
- A 429 is retried after `Retry-After`.
- Errors raise `OpenMediaError` with `status`, `code` and `message`.

<sub>Part of <a href="https://github.com/mihirkavi/open-media">Open Media</a> · <a href="https://api.openmedia.site/docs">Docs</a> · MIT licence</sub>
