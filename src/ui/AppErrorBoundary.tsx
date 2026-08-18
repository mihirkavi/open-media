import { Component, ErrorInfo, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

interface Props { children: ReactNode; }
interface State { failed: boolean; }

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Open Media render failure', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return <View style={styles.screen} accessibilityRole="alert">
      <Text style={styles.title}>Open Media needs to restart this screen.</Text>
      <Text style={styles.copy}>Your account and messages are safe. Try loading the app again.</Text>
      <Pressable accessibilityRole="button" onPress={() => this.setState({ failed: false })} style={styles.button}>
        <Text style={styles.buttonText}>Try again</Text>
      </Pressable>
    </View>;
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F7F5F0' },
  title: { maxWidth: 430, color: '#111111', fontSize: 24, lineHeight: 30, fontWeight: '800', textAlign: 'center' },
  copy: { maxWidth: 430, marginTop: 10, color: '#5F6368', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  button: { minHeight: 48, marginTop: 20, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 24, backgroundColor: '#111111' },
  buttonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
