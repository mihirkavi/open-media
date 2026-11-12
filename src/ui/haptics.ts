import { Platform } from 'react-native';

/**
 * Haptics the way iOS apps use them (ADR 0040, Apple's "Playing haptics"): a selection tick when a
 * choice changes, a light tap when something lands (a like, a sent message, a reaction), and a
 * success or error tap for a finished task. Never for ordinary taps or scrolling. The module loads
 * on first use; on the web, and wherever the device can't, nothing happens.
 */
type Haptics = typeof import('expo-haptics');
let module: Promise<Haptics | undefined> | undefined;
const load = () => (module ??= Platform.OS === 'web' ? Promise.resolve(undefined) : import('expo-haptics').catch(() => undefined));

/** A choice changed: a filter, a tab inside a screen, a reaction picked. */
export function selectionHaptic(): void {
  load().then((haptics) => haptics?.selectionAsync()).catch(() => undefined);
}

/** Something small landed: a like, a message sent, a tapback bar opening. */
export function lightHaptic(): void {
  load().then((haptics) => haptics?.impactAsync(haptics.ImpactFeedbackStyle.Light)).catch(() => undefined);
}

/** A firmer tap for a long press that opens something (the tapback bar). */
export function mediumHaptic(): void {
  load().then((haptics) => haptics?.impactAsync(haptics.ImpactFeedbackStyle.Medium)).catch(() => undefined);
}

/** A task finished: a post published everywhere. */
export function successHaptic(): void {
  load().then((haptics) => haptics?.notificationAsync(haptics.NotificationFeedbackType.Success)).catch(() => undefined);
}

/** A task failed. */
export function errorHaptic(): void {
  load().then((haptics) => haptics?.notificationAsync(haptics.NotificationFeedbackType.Error)).catch(() => undefined);
}
