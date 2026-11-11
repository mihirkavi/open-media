import type { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';

const caches = new WeakMap<object, WeakMap<ThemeColors, unknown>>();

/**
 * A screen's styles built once per theme, not once per component instance. Long lists render the
 * same row hundreds of times; `useMemo(() => createStyles(colors))` in each row built a full
 * StyleSheet for every one of them. The factory must be a module-level function.
 */
export function useThemedStyles<T>(factory: (colors: ThemeColors) => T): T {
  const { colors } = useOpenMediaTheme();
  let byTheme = caches.get(factory);
  if (!byTheme) { byTheme = new WeakMap(); caches.set(factory, byTheme); }
  let styles = byTheme.get(colors) as T | undefined;
  if (!styles) { styles = factory(colors); byTheme.set(colors, styles); }
  return styles;
}
