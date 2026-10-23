/**
 * iOS 27 stops apps at launch (`_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`)
 * unless they adopt the UIScene life cycle. Expo ships `ExpoAppSceneDelegate` for this, but the
 * SDK 57 app template still creates the window in the app delegate. This plugin:
 *
 * 1. declares a single window scene in Info.plist, delegated to Expo's `EXExpoAppSceneDelegate`;
 * 2. makes `AppDelegate` an `ExpoReactNativeFactoryProvider` and leaves window creation and
 *    `startReactNative` to the scene delegate.
 *
 * Remove once the Expo template adopts scenes itself.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const sceneManifest = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
    ],
  },
};

const windowStartPattern = /\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\(\n\s*withModuleName: "main",\n\s*in: window,\n\s*launchOptions: launchOptions\)\n#endif\n/;

function adoptScenes(contents) {
  if (contents.includes('ExpoReactNativeFactoryProvider')) return contents;
  if (!windowStartPattern.test(contents)) {
    throw new Error('with-ios-scene-lifecycle: AppDelegate.swift no longer matches the expected Expo template; update the plugin.');
  }
  return contents
    .replace('class AppDelegate: ExpoAppDelegate {', 'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {')
    .replace(windowStartPattern, '\n    // The window and React Native start in ExpoAppSceneDelegate (UIScene life cycle, required by iOS 27).\n');
}

module.exports = function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (next) => {
    next.modResults.UIApplicationSceneManifest = sceneManifest;
    return next;
  });
  return withAppDelegate(config, (next) => {
    if (next.modResults.language !== 'swift') throw new Error('with-ios-scene-lifecycle expects a Swift AppDelegate.');
    next.modResults.contents = adoptScenes(next.modResults.contents);
    return next;
  });
};

module.exports.adoptScenes = adoptScenes;
