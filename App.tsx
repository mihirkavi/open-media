import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { AppErrorBoundary } from './src/ui/AppErrorBoundary';
import { OpenMediaEntry } from './src/ui/OpenMediaEntry';
import { OpenMediaThemeProvider, useOpenMediaTheme } from './src/themeContext';

function ThemedApp() {
  const { colors, isDark } = useOpenMediaTheme();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'bottom']}><StatusBar style={isDark ? 'light' : 'dark'} /><OpenMediaEntry /></SafeAreaView>;
}

export default function App() {
  return <AppErrorBoundary><SafeAreaProvider><OpenMediaThemeProvider><ThemedApp /></OpenMediaThemeProvider></SafeAreaProvider></AppErrorBoundary>;
}
