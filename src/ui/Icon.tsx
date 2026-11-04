import createIconSet from '@expo/vector-icons/createIconSet';

import glyphMap from './iconGlyphs.json';

/**
 * Open Media's icons: Ionicons, cut down to the icons the app uses (scripts/subset-icons.py), so
 * the web app downloads a 51 KB font instead of a 390 KB one. It works exactly like Ionicons.
 * Names come from iconGlyphs.json, so an icon that isn't in the font yet fails the typecheck:
 * run `npm run icons:subset` after using a new one.
 */
const Ionicons = createIconSet(glyphMap, 'open-media-icons', require('../../assets/fonts/OpenMediaIcons.ttf'));

export default Ionicons;
