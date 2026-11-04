import { registerRootComponent } from 'expo';
import { Platform } from 'react-native';

import App from './App';
import { completeOAuthWindow } from './src/connectors/publishing/oauthCallback';

// On web, a page that only finishes a network's sign-in window hands back the result and closes.
if (Platform.OS !== 'web' || !completeOAuthWindow()) {
  // registerRootComponent calls AppRegistry.registerComponent('main', () => App);
  // It also ensures that whether you load the app in Expo Go or in a native build,
  // the environment is set up appropriately
  registerRootComponent(App);
}
