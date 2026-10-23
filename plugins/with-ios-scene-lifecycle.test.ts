import assert from 'node:assert/strict';
import test from 'node:test';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { adoptScenes } = require('./with-ios-scene-lifecycle.js') as { adoptScenes(contents: string): string };

// The SDK 57 Expo template's AppDelegate.swift (the part the plugin changes).
const template = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}`;

test('AppDelegate provides the factory and leaves the window to the scene delegate (iOS 27)', () => {
  const adopted = adoptScenes(template);
  assert.match(adopted, /class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider \{/);
  assert.doesNotMatch(adopted, /UIWindow\(frame:/);
  assert.doesNotMatch(adopted, /startReactNative/);
  assert.equal(adoptScenes(adopted), adopted, 'applying twice changes nothing');
});

test('An unexpected template fails the build instead of shipping a crashing app', () => {
  assert.throws(() => adoptScenes('@main\nclass AppDelegate: ExpoAppDelegate {}'), /no longer matches/);
});
