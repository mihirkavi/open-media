import Ionicons from './Icon';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text, TextInput } from './Text';

import { AiKeysSummary, chooseAiModel, loadAiKeys, removeAiKey, saveAiKey } from '../connectors/aiChatConnector';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Loader } from './Loader';

/** Where each provider hands out API keys, so people get one from the provider itself. */
const keyPages: Record<string, string> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys',
  google: 'https://aistudio.google.com/apikey',
  openrouter: 'https://openrouter.ai/settings/keys',
  groq: 'https://console.groq.com/keys',
  mistral: 'https://console.mistral.ai/api-keys',
  deepseek: 'https://platform.deepseek.com/api_keys',
  xai: 'https://console.x.ai',
};

/** Who bills for each provider's calls. */
const companies: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', openrouter: 'OpenRouter', groq: 'Groq', mistral: 'Mistral', deepseek: 'DeepSeek', xai: 'xAI' };

const keyShapes: Record<string, string> = { openai: 'sk-…', anthropic: 'sk-ant-…', google: 'AIza…', openrouter: 'sk-or-v1-…', groq: 'gsk_…', xai: 'xai-…' };

/**
 * Settings → Open Media AI (ADR 0028 §9). The safer place for API keys: a key typed here goes to
 * the Open Media service once, is encrypted there, and never comes back or appears in a chat.
 * Only its provider and last four characters are shown.
 */
export function AiModelsSettings({ signedIn }: { signedIn: boolean }) {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const [summary, setSummary] = useState<AiKeysSummary>();
  const [provider, setProvider] = useState('anthropic');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');

  useEffect(() => {
    if (!signedIn) return;
    loadAiKeys().then(setSummary).catch((reason: Error) => setError(reason.message));
  }, [signedIn]);

  if (!signedIn) return <Text style={styles.intro}>Sign in to use your own API key for ChatGPT, Claude, Gemini and more. Until then, Open Media AI answers with a free built-in model.</Text>;
  if (!summary) return error ? <Text accessibilityLiveRegion="assertive" style={[styles.intro, styles.error]}>{error}</Text> : <View style={styles.loading}><Loader color={colors.text} /></View>;

  const run = async (label: string, action: () => Promise<AiKeysSummary>, done = '') => {
    setBusy(label); setError(''); setSaved('');
    try { setSummary(await action()); setSaved(done); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(undefined); }
  };
  const save = () => {
    const value = key.trim();
    if (!value) return;
    // The key leaves the field at once; only the service keeps it, encrypted.
    setKey('');
    const name = summary.providers.find((item) => item.id === provider)?.name ?? provider;
    run('save', () => saveAiKey(provider, value), `Saved your ${name} key ending ${value.slice(-4)}. ${name} answers in Open Media AI now.`);
  };
  const chosen = summary.providers.find((item) => item.id === provider);
  const answering = summary.answering.provider;

  return <View>
    <Text style={styles.intro}>Use your own AI in the Open Media AI chat in Messages. Keys are encrypted on Open Media’s server and never shown again, only their last four characters. Add keys here rather than pasting them into a chat.</Text>
    <Text style={styles.label}>Who answers</Text>
    <ModelRow name="Llama" detail="Free, built in" selected={answering === 'built-in'} disabled={Boolean(busy)} onSelect={() => run('built-in', () => chooseAiModel('built-in'))} styles={styles} colors={colors} />
    {summary.keys.map((item) => <ModelRow key={item.provider} name={item.name} detail={item.usable ? `Key ending ${item.hint} · ${item.model}` : `Key ending ${item.hint} can’t be used any more. Remove it and add it again.`} selected={answering === item.provider} disabled={Boolean(busy) || !item.usable} onSelect={() => run(item.provider, () => chooseAiModel(item.provider))} styles={styles} colors={colors}
      trailing={busy === `remove:${item.provider}` ? <Loader color={colors.text} /> : <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.name} key ending ${item.hint}`} disabled={Boolean(busy)} onPress={() => run(`remove:${item.provider}`, () => removeAiKey(item.provider), `Removed your ${item.name} key.`)} style={styles.button}><Text style={styles.buttonText}>Remove</Text></Pressable>} />)}

    <View style={styles.add}>
      <Text style={styles.label}>Add a key</Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {summary.providers.map((item) => <Pressable key={item.id} accessibilityRole="radio" accessibilityState={{ checked: provider === item.id }} onPress={() => { setProvider(item.id); setError(''); }} style={[styles.chip, provider === item.id && styles.chipActive]}><Text style={[styles.chipText, provider === item.id && styles.chipTextActive]}>{item.name}</Text></Pressable>)}
      </View>
      <View style={[styles.rowTop, styles.padded]}>
        <TextInput accessibilityLabel={`${chosen?.name ?? ''} API key`} value={key} onChangeText={setKey} placeholder={keyShapes[provider] ? `${chosen?.name} key (${keyShapes[provider]})` : `${chosen?.name} key`} placeholderTextColor={colors.textTertiary}
          secureTextEntry autoCapitalize="none" autoCorrect={false} autoComplete="off" importantForAutofill="no" spellCheck={false} onSubmitEditing={save} returnKeyType="done" style={[styles.input, styles.copy]} />
        {busy === 'save' ? <Loader color={colors.text} /> : <Pressable accessibilityRole="button" disabled={!key.trim() || Boolean(busy)} onPress={save} style={[styles.button, styles.primary, (!key.trim() || Boolean(busy)) && styles.disabled]}><Text style={[styles.buttonText, styles.primaryText]}>Save</Text></Pressable>}
      </View>
      <Text style={styles.hint}>
        {chosen ? <>Uses {chosen.model}. </> : null}
        {keyPages[provider] ? <Text accessibilityRole="link" onPress={() => { Linking.openURL(keyPages[provider]).catch(() => undefined); }} style={styles.link}>Get a {chosen?.name} key</Text> : null}
        . {companies[provider] ?? 'The provider'} bills your account for what you use. Saving a key makes it answer.
      </Text>
      {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      {saved ? <Text accessibilityLiveRegion="polite" style={styles.saved}>{saved}</Text> : null}
    </View>
  </View>;
}

function ModelRow({ name, detail, selected, disabled, onSelect, trailing, styles, colors }: { name: string; detail: string; selected: boolean; disabled: boolean; onSelect: () => void; trailing?: React.ReactNode; styles: ReturnType<typeof createStyles>; colors: ThemeColors }) {
  return <View style={styles.row}>
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected, disabled }} accessibilityLabel={`${name} answers`} disabled={disabled} onPress={onSelect} style={[styles.rowTop, styles.copy]}>
      <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={18} color={selected ? colors.text : colors.textTertiary} />
      <View style={styles.copy}><Text style={styles.name}>{name}</Text><Text style={styles.detail}>{detail}</Text></View>
    </Pressable>
    {trailing}
  </View>;
}

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  intro: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6, color: colors.textSecondary, fontSize: 13, lineHeight: 19 },
  loading: { padding: 16, alignItems: 'center' },
  label: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, color: colors.textTertiary, fontSize: 12, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  detail: { marginTop: 2, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
  add: { gap: 10, paddingBottom: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16 },
  chip: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 16, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.text, borderColor: colors.text },
  chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.surface },
  hint: { paddingHorizontal: 16, color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
  link: { color: colors.text, textDecorationLine: 'underline' },
  error: { paddingHorizontal: 16, color: colors.danger, fontSize: 12, lineHeight: 16 },
  saved: { paddingHorizontal: 16, color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  padded: { paddingHorizontal: 16 },
  input: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, backgroundColor: colors.surface, fontSize: 16, letterSpacing: 0, paddingVertical: 0, outlineStyle: 'none' } as object,
  disabled: { opacity: 0.4 },
  button: { minHeight: 36, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '600' },
  primary: { backgroundColor: colors.text, borderColor: colors.text },
  primaryText: { color: colors.surface },
}); }
