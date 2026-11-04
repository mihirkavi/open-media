# Fonts

Fonts the app bundles itself.

- `OpenMediaIcons.ttf`: Ionicons (MIT, from `@expo/vector-icons`) cut down to the icons Open Media uses, so the web app downloads about 51 KB instead of 390 KB. Its glyph map is `src/ui/iconGlyphs.json`, and `src/ui/Icon.tsx` draws it.

Both files are generated: run `npm run icons:subset` (needs Python's `fontTools`) after using a new icon. Never edit them by hand. The typecheck fails when code uses an icon that isn't in the font yet.
