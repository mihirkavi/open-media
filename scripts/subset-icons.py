#!/usr/bin/env python3
"""
Builds Open Media's icon font: Ionicons, cut down to the icons the app uses.

The full Ionicons font is 390 KB (about 210 KB compressed) with 1,300+ icons, and the web app must
download it before any icon draws. Open Media uses a small fraction of them, so this script keeps
only those:

1. It reads every quoted word in src/ (tests excluded) and keeps those that are Ionicons names.
   Over-including a word that happens to be an icon name costs a few bytes; nothing is missed,
   because icon names in this codebase are always written out in full.
2. It writes the matching glyph map to src/ui/iconGlyphs.json and the cut-down font to
   assets/fonts/OpenMediaIcons.ttf (with fontTools' pyftsubset).

src/ui/Icon.tsx types icon names from iconGlyphs.json, so using an icon that isn't in the font yet
fails the typecheck. Run `npm run icons:subset` after adding one. Paths resolve from this file,
never from the caller's directory.
"""
import json
import pathlib
import re
import subprocess
import sys

root = pathlib.Path(__file__).resolve().parent.parent
vendor = root / 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons'
full_map = json.loads((vendor / 'glyphmaps/Ionicons.json').read_text())
full_font = vendor / 'Fonts/Ionicons.ttf'
glyphs_out = root / 'src/ui/iconGlyphs.json'
font_out = root / 'assets/fonts/OpenMediaIcons.ttf'

quoted = re.compile(r'''["'`]([a-z0-9][a-z0-9-]*)["'`]''')
used: set[str] = set()
for path in sorted((root / 'src').rglob('*')):
    if path.suffix not in {'.ts', '.tsx'} or '.test.' in path.name:
        continue
    used.update(name for name in quoted.findall(path.read_text(encoding='utf-8')) if name in full_map)

if not used:
    sys.exit('No Ionicons names found in src/; refusing to write an empty icon font.')

subset = {name: full_map[name] for name in sorted(used)}
glyphs_out.write_text(json.dumps(subset, indent=2) + '\n')
font_out.parent.mkdir(parents=True, exist_ok=True)
unicodes = ','.join(f'U+{code:04X}' for code in sorted(set(subset.values())))
subprocess.run([
    sys.executable, '-m', 'fontTools.subset', str(full_font),
    f'--unicodes={unicodes}', f'--output-file={font_out}',
    '--layout-features=*', '--no-hinting', '--desubroutinize', '--name-IDs=*', '--notdef-outline',
], check=True)
print(f'{len(subset)} of {len(full_map)} icons, {font_out.stat().st_size:,} bytes (was {full_font.stat().st_size:,})')
