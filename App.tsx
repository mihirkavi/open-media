import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic } from '@expo-google-fonts/instrument-serif';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AppErrorBoundary } from './src/ui/AppErrorBoundary';
import { OpenMediaEntry } from './src/ui/OpenMediaEntry';
import { OpenMediaThemeProvider, useOpenMediaTheme } from './src/themeContext';
import { registerWebMcpTools } from './src/web/webMcp';

// Keep the launch screen up until the fonts are ready, so text never flashes in a fallback font.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function ThemedApp() {
  const { colors, isDark } = useOpenMediaTheme();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'bottom']}><StatusBar style={isDark ? 'light' : 'dark'} /><OpenMediaEntry /></SafeAreaView>;
}

export default function App() {
  // Inter for the interface, Instrument Serif for editorial headlines (src/ui/Text.tsx).
  // If a font fails to load, the app still opens with the platform's own fonts.
  const [loaded, error] = useFonts({
    Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold,
    InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic,
  });
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);
  // On the web, agents in the person's browser can search and read through WebMCP.
  useEffect(() => registerWebMcpTools(), []);
  if (!loaded && !error) return null;
  return <AppErrorBoundary><SafeAreaProvider><OpenMediaThemeProvider><ThemedApp /></OpenMediaThemeProvider></SafeAreaProvider></AppErrorBoundary>;
}
