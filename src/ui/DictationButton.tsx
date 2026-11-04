import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DictationSession } from '../data/dictationService';
import { insertDictation } from '../domain/dictation';
import { ThemeColors, lightColors } from '../theme';
import { useOptionalOpenMediaTheme } from '../themeContext';
import { useReducedMotion } from './AiMark';
import Ionicons from './Icon';
import { Loader } from './Loader';

/**
 * The mic inside every text field people write in (ADR 0031). Tap to talk and tap again to put
 * the words in, or hold it down and let go when you're done. Escape throws a take away. While it
 * listens, the button turns ink-black and its bars move with your voice; while Whisper writes,
 * it shows the Open Media mark. The recorder itself loads only when a mic is first pressed.
 */

type Phase = 'idle' | 'starting' | 'listening' | 'writing';
type FieldNode = HTMLInputElement | HTMLTextAreaElement;

export const dictationButtonSize = 30;
/** Room the field keeps free on its right for the button. */
export const dictationInset = dictationButtonSize + 8;
const holdMs = 450;
const barCount = 4;

let supported: boolean | undefined;
function browserCanDictate(): boolean {
  if (Platform.OS !== 'web') return false;
  if (supported === undefined) {
    const scope = globalThis as unknown as { navigator?: Navigator; SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
    supported = Boolean(scope.navigator?.mediaDevices?.getUserMedia) || Boolean(scope.SpeechRecognition ?? scope.webkitSpeechRecognition);
  }
  return supported;
}

export function DictationButton({ target, multiline, maxLength, fieldHeight }: { target: () => FieldNode | null; multiline?: boolean; maxLength?: number; fieldHeight?: number }) {
  const theme = useOptionalOpenMediaTheme();
  const colors = theme?.colors ?? lightColors;
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<Phase>('idle');
  const [levels, setLevels] = useState<number[]>(() => Array(barCount).fill(0));
  const [notice, setNotice] = useState<string | undefined>();
  const session = useRef<DictationSession | undefined>(undefined);
  const selection = useRef<{ value: string; start: number; end: number } | undefined>(undefined);
  const pressedAt = useRef(0);
  const startedThisPress = useRef(false);
  const phaseRef = useRef<Phase>('idle');
  const halo = useRef(new Animated.Value(0)).current;
  const mounted = useRef(true);
  phaseRef.current = phase;

  useEffect(() => () => { mounted.current = false; session.current?.cancel(); }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(undefined), 3600);
    return () => clearTimeout(timer);
  }, [notice]);

  const finish = useCallback(async () => {
    const current = session.current;
    if (!current || phaseRef.current !== 'listening') return;
    session.current = undefined;
    setPhase('writing');
    try {
      const spoken = await current.stop();
      const node = target();
      if (!mounted.current) return;
      if (!spoken) setNotice('Didn’t catch that. Try again a little closer.');
      else if (node) insertInto(node, spoken, selection.current, multiline, maxLength);
    } catch (error) {
      if (mounted.current) setNotice(error instanceof Error ? error.message : 'Dictation failed.');
    } finally {
      if (mounted.current) { setPhase('idle'); setLevels(Array(barCount).fill(0)); }
    }
  }, [target, multiline, maxLength]);

  const start = useCallback(async () => {
    if (phaseRef.current !== 'idle') return;
    const node = target();
    if (node) selection.current = { value: node.value, start: node.selectionStart ?? node.value.length, end: node.selectionEnd ?? node.value.length };
    setNotice(undefined);
    setPhase('starting');
    try {
      const { startDictation } = await import('../data/dictationService');
      const started = await startDictation({
        onLevel: (level) => {
          if (!mounted.current) return;
          setLevels((previous) => [...previous.slice(1), level]);
          halo.setValue(level);
        },
        onLimit: () => { setNotice('Two minutes is the most in one go.'); void finish(); },
      });
      if (!mounted.current || (phaseRef.current as Phase) !== 'starting') { started.cancel(); return; }
      session.current = started;
      phaseRef.current = 'listening';
      setPhase('listening');
      target()?.focus();
    } catch (error) {
      if (!mounted.current) return;
      setPhase('idle');
      setNotice(error instanceof Error ? error.message : 'Dictation couldn’t start.');
    }
  }, [target, halo, finish]);

  const cancel = useCallback(() => {
    session.current?.cancel();
    session.current = undefined;
    setPhase('idle');
    setLevels(Array(barCount).fill(0));
  }, []);

  // Escape throws the take away, wherever focus is.
  useEffect(() => {
    if (phase !== 'listening' && phase !== 'starting') return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, cancel]);

  if (!browserCanDictate()) return null;

  const listening = phase === 'listening';
  // A tall box (a post, a bio) keeps the mic in its bottom corner; one-line fields centre it.
  const tall = Boolean(multiline) && (fieldHeight ?? 0) >= 56;
  const label = listening ? 'Stop and insert dictation' : phase === 'writing' ? 'Writing what you said' : 'Dictate: speak to type';
  const styles = stylesFor(colors);
  const haloScale = halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] });
  const haloOpacity = halo.interpolate({ inputRange: [0, 0.05, 1], outputRange: [0, 0.18, 0.32] });

  return (
    <View pointerEvents="box-none" style={[styles.anchor, tall ? styles.anchorBottom : styles.anchorMiddle, fieldHeight !== undefined && fieldHeight < 36 && styles.anchorCompact]}>
      {notice ? <View pointerEvents="none" style={styles.notice}><Text accessibilityLiveRegion="polite" style={styles.noticeText}>{notice}</Text></View> : null}
      {listening && !reduced ? <Animated.View pointerEvents="none" style={[styles.halo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]} /> : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ busy: phase === 'writing' || phase === 'starting', selected: listening }}
        // @ts-expect-error React Native Web shows `title` as the hover tooltip.
        title={listening ? 'Tap to insert · Esc to cancel' : 'Dictate (tap, or hold to talk)'}
        disabled={phase === 'writing'}
        onPressIn={() => {
          pressedAt.current = Date.now();
          startedThisPress.current = phaseRef.current === 'idle';
          if (startedThisPress.current) void start();
        }}
        onPressOut={() => {
          // Held down: push to talk, so letting go inserts the words.
          if (startedThisPress.current && Date.now() - pressedAt.current > holdMs) void finish();
        }}
        onPress={() => {
          if (!startedThisPress.current && phaseRef.current === 'listening') void finish();
        }}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
          styles.button,
          phase === 'idle' && styles.buttonIdle,
          (hovered || pressed) && phase === 'idle' && styles.buttonHover,
          (listening || phase === 'starting') && styles.buttonLive,
          phase === 'writing' && styles.buttonWriting,
          pressed && styles.buttonPressed,
        ]}
      >
        {({ hovered }: { hovered?: boolean; pressed: boolean }) => listening
          ? <View style={styles.bars}>{levels.map((level, index) => <Bar key={index} level={level} index={index} reduced={reduced} color={colors.surface} />)}</View>
          : phase === 'writing'
            ? <Loader size={15} color={colors.text} accessibilityLabel="Transcribing" />
            : phase === 'starting'
              ? <Pulse color={colors.surface} />
              : <Ionicons name="mic" size={15} color={hovered ? colors.text : colors.textSecondary} />}
      </Pressable>
    </View>
  );
}

function Bar({ level, index, reduced, color }: { level: number; index: number; reduced: boolean; color: string }) {
  // The middle bars move most, like a voice; each bar keeps a little height so it reads as a meter.
  const weight = index === 1 || index === 2 ? 1 : 0.7;
  const height = 3 + Math.round((reduced ? Math.min(level, 0.5) : level) * 11 * weight);
  return <View style={{ width: 2.5, height, borderRadius: 2, backgroundColor: color, marginHorizontal: 1 }} />;
}

function Pulse({ color }: { color: string }) {
  const value = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(value, { toValue: 1, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(value, { toValue: 0.4, duration: 420, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [value]);
  return <Animated.View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color, opacity: value }} />;
}

/** Writes into the field the way typing would, so the field's own onChangeText runs. */
function insertInto(node: FieldNode, spoken: string, saved: { value: string; start: number; end: number } | undefined, multiline?: boolean, maxLength?: number) {
  const unchanged = saved && saved.value === node.value;
  const start = unchanged ? saved.start : node.selectionStart ?? node.value.length;
  const end = unchanged ? saved.end : node.selectionEnd ?? node.value.length;
  const { text, cursor } = insertDictation(node.value, start, end, spoken, { multiline, maxLength });
  const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(node, text);
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.focus();
  try { node.setSelectionRange(cursor, cursor); } catch { /* some input types have no selection */ }
}

const cache = new WeakMap<ThemeColors, ReturnType<typeof createStyles>>();
function stylesFor(colors: ThemeColors) {
  let styles = cache.get(colors);
  if (!styles) { styles = createStyles(colors); cache.set(colors, styles); }
  return styles;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    anchor: { position: 'absolute', right: 5, width: dictationButtonSize, height: dictationButtonSize, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
    anchorMiddle: { top: '50%', marginTop: -dictationButtonSize / 2 },
    anchorBottom: { bottom: 6 },
    anchorCompact: { right: 3 },
    halo: { position: 'absolute', width: dictationButtonSize, height: dictationButtonSize, borderRadius: dictationButtonSize / 2, backgroundColor: colors.accent },
    button: {
      width: dictationButtonSize, height: dictationButtonSize, borderRadius: dictationButtonSize / 2,
      alignItems: 'center', justifyContent: 'center',
      ...(Platform.OS === 'web' ? { transitionDuration: '160ms', transitionProperty: 'background-color, transform, box-shadow', cursor: 'pointer' } as object : {}),
    },
    // At rest it is a soft chip with a hairline edge, so it can be found in any field and theme.
    buttonIdle: { backgroundColor: colors.accentSoft, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    buttonHover: { backgroundColor: colors.border, borderColor: colors.textTertiary },
    buttonLive: {
      backgroundColor: colors.accent,
      ...(Platform.OS === 'web' ? { boxShadow: '0 2px 10px rgba(0,0,0,0.18)' } as object : {}),
    },
    buttonWriting: { backgroundColor: colors.accentSoft },
    buttonPressed: { transform: [{ scale: 0.92 }] },
    bars: { flexDirection: 'row', alignItems: 'center', height: 16 },
    notice: {
      position: 'absolute', bottom: dictationButtonSize + 6, right: 0, width: 220,
      backgroundColor: colors.accent, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 7,
      ...(Platform.OS === 'web' ? { boxShadow: '0 6px 20px rgba(0,0,0,0.16)' } as object : {}),
    },
    // Text.tsx renders this button, so the notice sets the interface font itself.
    noticeText: { color: colors.surface, fontSize: 12, lineHeight: 16, fontWeight: '500', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif' },
  });
}
