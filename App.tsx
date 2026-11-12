import { InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic, useFonts } from '@expo-google-fonts/instrument-serif';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { Platform } from 'react-native';

import { passkeyBridgePath } from './src/domain/passkeyBridge';
import { AppErrorBoundary } from './src/ui/AppErrorBoundary';
import { GestureRoot } from './src/ui/edgeSwipe';
import { lazyComponent } from './src/ui/lazyComponent';
import { OpenMediaEntry } from './src/ui/OpenMediaEntry';
import { OpenMediaThemeProvider, useOpenMediaTheme } from './src/themeContext';
import { registerWebMcpTools } from './src/web/webMcp';

// openmedia.site/passkey is the page the phone app opens to use a passkey (ADR 0034).
const PasskeyBridge = lazyComponent(() => import('./src/ui/PasskeyBridge').then((module) => module.PasskeyBridge));
const passkeyBridgePage = Platform.OS === 'web' && typeof window !== 'undefined' && window.location.pathname === passkeyBridgePath;

// Keep the launch screen up until the fonts are ready, so text never flashes in a fallback font.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function ThemedApp() {
  const { colors, isDark } = useOpenMediaTheme();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'bottom']}><StatusBar style={isDark ? 'light' : 'dark'} />{passkeyBridgePage ? <PasskeyBridge /> : <OpenMediaEntry />}</SafeAreaView>;
}

export default function App() {
  // The device's own font (SF Pro on Apple devices) for the interface, and Instrument Serif for
  // editorial headlines (src/ui/Text.tsx). Only the serif needs loading.
  // If a font fails to load, the app still opens with the platform's own fonts.
  const [loaded, error] = useFonts({
    InstrumentSerif_400Regular, InstrumentSerif_400Regular_Italic,
  });
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => undefined);
  }, [loaded, error]);
  // On the web, agents in the person's browser can search and read through WebMCP.
  useEffect(() => registerWebMcpTools(), []);
  if (!loaded && !error) return null;
  return <AppErrorBoundary><GestureRoot><SafeAreaProvider><OpenMediaThemeProvider><ThemedApp /></OpenMediaThemeProvider></SafeAreaProvider></GestureRoot></AppErrorBoundary>;
}
