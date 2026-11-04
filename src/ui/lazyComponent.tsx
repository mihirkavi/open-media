import { ComponentType, lazy, Suspense } from 'react';
import { StyleSheet, View } from 'react-native';

import { Loader } from './Loader';

export type LazyComponent<P> = ComponentType<P> & {
  /** Starts downloading the component's code without showing it, so it opens instantly later. */
  preload: () => Promise<unknown>;
};

/**
 * A component whose code is downloaded the first time it is shown (or preloaded), not with the
 * app. On the web, Metro puts each `import()` in its own file, so screens people open later, such
 * as settings, the message picker or profile editing, don't slow the first page down. Native
 * builds bundle everything together, so there it costs nothing.
 *
 * Pass `() => import('./Screen').then((module) => module.Screen)`. While the code arrives, the
 * Open Media loader shows in the space the component will take. A failed download is retried the
 * next time the component is shown.
 */
export function lazyComponent<P extends object>(load: () => Promise<ComponentType<P>>, fallback: 'screen' | 'none' = 'screen'): LazyComponent<P> {
  let pending: Promise<{ default: ComponentType<P> }> | undefined;
  const start = () => (pending ??= load().then(
    (component) => ({ default: component }),
    (error: unknown) => { pending = undefined; throw error; },
  ));
  const Lazy = lazy(start) as unknown as ComponentType<P>;
  function Loaded(props: P) {
    return <Suspense fallback={fallback === 'screen' ? <View style={styles.fallback}><Loader /></View> : null}><Lazy {...props} /></Suspense>;
  }
  Loaded.preload = start;
  return Loaded;
}

/** Runs `task` once the browser is idle (or soon after, elsewhere), so preloading never competes with the first paint. */
export function whenIdle(task: () => void): () => void {
  const idle = (globalThis as { requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void });
  if (idle.requestIdleCallback && idle.cancelIdleCallback) {
    const id = idle.requestIdleCallback(task, { timeout: 4000 });
    return () => idle.cancelIdleCallback!(id);
  }
  const timer = setTimeout(task, 1500);
  return () => clearTimeout(timer);
}

const styles = StyleSheet.create({
  fallback: { flex: 1, minHeight: 120, alignItems: 'center', justifyContent: 'center' },
});
