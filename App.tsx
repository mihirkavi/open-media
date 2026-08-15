import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { OpenMediaApp } from './src/ui/OpenMediaApp';
import { OpenMediaThemeProvider, useOpenMediaTheme } from './src/themeContext';

function ThemedApp() {
  const { colors, isDark } = useOpenMediaTheme();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'bottom']}><StatusBar style={isDark ? 'light' : 'dark'} /><OpenMediaApp /></SafeAreaView>;
}

export default function App() {
  return <SafeAreaProvider><OpenMediaThemeProvider><ThemedApp /></OpenMediaThemeProvider></SafeAreaProvider>;
}
