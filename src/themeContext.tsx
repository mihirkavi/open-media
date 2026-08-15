import AsyncStorage from '@react-native-async-storage/async-storage';
import { PropsWithChildren, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ColorSchemeName, useColorScheme } from 'react-native';

import { AppearanceMode, ThemeColors, darkColors, lightColors } from './theme';

interface ThemeContextValue {
  appearance: AppearanceMode;
  colors: ThemeColors;
  isDark: boolean;
  setAppearance: (appearance: AppearanceMode) => void;
}

const appearanceStorageKey = 'open-media.appearance';
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function resolveDark(appearance: AppearanceMode, systemScheme: ColorSchemeName) {
  return appearance === 'dark' || (appearance === 'system' && systemScheme === 'dark');
}

export function OpenMediaThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [appearance, setAppearanceState] = useState<AppearanceMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(appearanceStorageKey).then((stored) => {
      if (stored === 'system' || stored === 'light' || stored === 'dark') setAppearanceState(stored);
    }).catch(() => undefined);
  }, []);

  const setAppearance = (next: AppearanceMode) => {
    setAppearanceState(next);
    AsyncStorage.setItem(appearanceStorageKey, next).catch(() => undefined);
  };
  const isDark = resolveDark(appearance, systemScheme);
  const value = useMemo(
    () => ({ appearance, setAppearance, isDark, colors: isDark ? darkColors : lightColors }),
    [appearance, isDark],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useOpenMediaTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error('useOpenMediaTheme must be used inside OpenMediaThemeProvider.');
  return value;
}
