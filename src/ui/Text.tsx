import { forwardRef } from 'react';
import { Platform, StyleSheet, Text as NativeText, TextInput as NativeTextInput, TextInputProps, TextProps, TextStyle } from 'react-native';

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

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <NativeTextInput ref={ref} {...props} style={uiTextStyle(style)} />;
});

/** Refs keep the platform types, so `useRef<TextInput>` works as it did before. */
export type Text = NativeText;
export type TextInput = NativeTextInput;
