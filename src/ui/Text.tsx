import { forwardRef, useCallback, useRef, useState } from 'react';
import { Platform, StyleSheet, Text as NativeText, TextInput as NativeTextInput, TextInputProps, TextProps, TextStyle, View, ViewStyle } from 'react-native';

import { dictationEligible } from '../domain/dictation';
import { DictationButton, dictationInset } from './DictationButton';
import { sfTracking } from './typeMetrics';

/**
 * Open Media's type: the device's own interface font for everything people read and type, and
 * Instrument Serif for the few editorial headlines on the landing and mission pages. On iPhone,
 * iPad and Mac that is SF Pro, the font apple.com uses; Android shows Roboto and Windows Segoe UI.
 * System fonts carry every weight, so `fontWeight` is passed straight through. On the web the
 * wrappers also apply apple.com's tracking; iOS applies SF's own tracking by itself.
 */
export const uiFontStack = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const serifFamily = 'InstrumentSerif_400Regular';
export const serifItalicFamily = 'InstrumentSerif_400Regular_Italic';

/** On the web an unloaded font must still fall back to a serif that isn't Times. */
const webSerifFallback = ', "Iowan Old Style", Georgia, serif';

export function uiTextStyle(style: TextProps['style']): TextStyle {
  const flat = (StyleSheet.flatten(style) ?? {}) as TextStyle;
  const size = flat.fontSize ?? 14;
  const out: TextStyle = { ...flat };
  if (flat.fontFamily === 'serif' || flat.fontFamily === serifFamily || flat.fontFamily === serifItalicFamily) {
    const family = flat.fontStyle === 'italic' || flat.fontFamily === serifItalicFamily ? serifItalicFamily : serifFamily;
    out.fontFamily = Platform.OS === 'web' ? family + webSerifFallback : family;
    delete out.fontWeight;
    delete out.fontStyle;
    return out;
  }
  // Monospace and any other explicit family are left as they are.
  if (flat.fontFamily) return out;
  // 800 is drawn as Bold: ExtraBold reads as shouting in a black-and-white interface.
  if (flat.fontWeight === '800' || flat.fontWeight === '900') out.fontWeight = '700';
  if (Platform.OS !== 'web') return out;
  out.fontFamily = uiFontStack;
  if (flat.letterSpacing === undefined) out.letterSpacing = Math.round(size * sfTracking(size) * 100) / 100;
  return out;
}

export const Text = forwardRef<NativeText, TextProps>(function Text({ style, ...props }, ref) {
  return <NativeText ref={ref} {...props} style={uiTextStyle(style)} />;
});

/** Layout that belongs to the field's place on the page, so it moves to the box that holds the mic. */
const outerKeys = new Set<keyof ViewStyle>([
  'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf', 'width', 'minWidth', 'maxWidth',
  'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical', 'marginStart', 'marginEnd',
  'position', 'top', 'bottom', 'left', 'right', 'zIndex',
]);

export interface OpenMediaTextInputProps extends TextInputProps {
  /** Show the dictation mic (ADR 0031). Left out, fields people write words in get one. */
  dictation?: boolean;
}

/**
 * Every text field in Open Media. On the web, fields people write words in also carry the
 * dictation mic at their right edge (ADR 0031); phones keep their keyboard's own dictation.
 */
export const TextInput = forwardRef<NativeTextInput, OpenMediaTextInputProps>(function TextInput({ style, dictation, ...props }, ref) {
  const node = useRef<NativeTextInput | null>(null);
  const [fieldHeight, setFieldHeight] = useState<number | undefined>();
  const setRef = useCallback((value: NativeTextInput | null) => {
    node.current = value;
    if (typeof ref === 'function') ref(value);
    else if (ref) ref.current = value;
  }, [ref]);
  const target = useCallback(() => node.current as unknown as HTMLInputElement | HTMLTextAreaElement | null, []);
  const textStyle = uiTextStyle(style);
  const withMic = Platform.OS === 'web' && dictationEligible({ ...(props as Record<string, unknown>), dictation } as Parameters<typeof dictationEligible>[0]);
  if (!withMic) return <NativeTextInput ref={setRef} {...props} style={textStyle} />;

  const outer: ViewStyle = { position: 'relative' };
  const inner: TextStyle = {};
  for (const [key, value] of Object.entries(textStyle)) {
    if (outerKeys.has(key as keyof ViewStyle)) (outer as Record<string, unknown>)[key] = value;
    else (inner as Record<string, unknown>)[key] = value;
  }
  // The field still fills its place: it keeps its own height, and grows with the box that holds it.
  if (outer.flex !== undefined || outer.flexGrow !== undefined) inner.flexGrow = 1;
  if (outer.position === 'absolute' && inner.height === undefined) inner.height = '100%';
  const ownRight = Number(inner.paddingRight ?? inner.paddingHorizontal ?? inner.padding ?? 0) || 0;
  inner.paddingRight = Math.max(ownRight, dictationInset);
  return (
    <View style={outer} onLayout={(event) => setFieldHeight(Math.round(event.nativeEvent.layout.height))}>
      <NativeTextInput ref={setRef} {...props} style={inner} />
      <DictationButton target={target} multiline={Boolean(props.multiline)} maxLength={props.maxLength} fieldHeight={fieldHeight} />
    </View>
  );
});

/** Refs keep the platform types, so `useRef<TextInput>` works as it did before. */
export type Text = NativeText;
export type TextInput = NativeTextInput;
