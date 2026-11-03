---
description: Shape your own feed algorithm in plain words - see its code, what a change does, and undo
argument-hint: "[e.g. less hive, more videos, only people I follow]"
---

My feed algorithm: $ARGUMENTS

Use the open-media-feed-lenses skill. If I asked for a change, call `tune_feed_lens` with `save: false` first and show me what it understood, the rules that change and the resulting manifest (the code that runs my Feed); save only when I agree. If I asked nothing, show my current lens with `list_my_feed_lenses` and explain how it ranks posts. Offer `revert_feed_lens` to undo.
