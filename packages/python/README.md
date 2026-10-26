# open-media (Python)

The official Python client for the [Open Media](https://github.com/mihirkavi/open-media) API. No dependencies; Python 3.9+.

```bash
pip install open-media
```

```python
from open_media import OpenMedia

om = OpenMedia()
for post in om.feed(sources=["farcaster", "lens"], mode="raw")["data"]:
    print(post["network"], post["author"]["handle"], post["text"], post["url"])

results = om.search("videos about cooking today")
events = om.events(query="ai founders", days=7)
```

Acting for a person needs their own token (in the app: Settings, then Developers and agents):

```python
import os
me = OpenMedia(token=os.environ["OPEN_MEDIA_TOKEN"])
me.publish("Hello from my agent")
```

Writes send an `Idempotency-Key` automatically, a 429 is retried after `Retry-After`, and errors raise `OpenMediaError` with `status`, `code` and `message`. Docs: https://api.openmedia.site/docs · MIT licence.
