import { forwardRef } from 'react';
import { Platform, StyleSheet, Text as NativeText, TextInput as NativeTextInput, TextInputProps, TextProps, TextStyle } from 'react-native';

import { interTracking } from './typeMetrics';

/**
 * Open Media's type: Inter for everything people read and type, Instrument Serif for the few
 * editorial headlines on the landing and mission pages. Each weight is its own font file, so the
 * wrappers below turn `fontWeight` into the matching family instead of letting the platform fake
 * a bold. They also apply Inter's dynamic tracking: large text is set slightly tighter and small
 * text stays open, the way the typeface was designed to be used.
 */
export const interFamilies: Record<string, string> = {
  '400': 'Inter_400Regular',
  '500': 'Inter_500Medium',
  '600': 'Inter_600SemiBold',
  '700': 'Inter_700Bold',
  // 800 is drawn as Bold: Inter's ExtraBold reads as shouting in a black-and-white interface.
  '800': 'Inter_700Bold',
};

export const serifFamily = 'InstrumentSerif_400Regular';
export const serifItalicFamily = 'InstrumentSerif_400Regular_Italic';

/** On the web an unloaded font must still fall back to a sans-serif, never to Times. */
const webFallback = ', Inter, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const webSerifFallback = ', "Iowan Old Style", Georgia, serif';

export function interStyle(style: TextProps['style']): TextStyle {
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
  const weight = String(flat.fontWeight ?? '400').replace('normal', '400').replace('bold', '700');
  const family = interFamilies[weight] ?? (Number(weight) > 700 ? interFamilies['800'] : Number(weight) < 500 ? interFamilies['400'] : interFamilies['600']);
  out.fontFamily = Platform.OS === 'web' ? family + webFallback : family;
  delete out.fontWeight;
  if (flat.letterSpacing === undefined) out.letterSpacing = Math.round(size * interTracking(size) * 100) / 100;
  return out;
}

export const Text = forwardRef<NativeText, TextProps>(function Text({ style, ...props }, ref) {
  return <NativeText ref={ref} {...props} style={interStyle(style)} />;
});

export const TextInput = forwardRef<NativeTextInput, TextInputProps>(function TextInput({ style, ...props }, ref) {
  return <NativeTextInput ref={ref} {...props} style={interStyle(style)} />;
});

/** Refs keep the platform types, so `useRef<TextInput>` works as it did before. */
export type Text = NativeText;
export type TextInput = NativeTextInput;
