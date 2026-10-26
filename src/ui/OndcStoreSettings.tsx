import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, View } from 'react-native';

import { apiConfigured } from '../connectors/mailApiConnector';
import { loadOndcStore, saveOndcStore, SavedOndcStore } from '../data/ondcService';
import { emptyOndcStore, ondcCategories, OndcStore, OndcStoreErrors, ondcReturnWindows, ondcShipTimes, validateOndcStore } from '../domain/ondc';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text, TextInput } from './Text';

type Field = 'storeName' | 'building' | 'locality' | 'city' | 'state' | 'areaCode' | 'stdCode' | 'gps' | 'phone' | 'email';
const fields: { key: Field; label: string; placeholder: string; keyboard?: 'numeric' | 'phone-pad' | 'email-address' }[] = [
  { key: 'storeName', label: 'Store name', placeholder: 'Asha Handlooms' },
  { key: 'building', label: 'Building or street', placeholder: '12 MG Road' },
  { key: 'locality', label: 'Area or locality', placeholder: 'Ashok Nagar' },
  { key: 'city', label: 'City', placeholder: 'Bengaluru' },
  { key: 'state', label: 'State', placeholder: 'Karnataka' },
  { key: 'areaCode', label: 'PIN code', placeholder: '560001', keyboard: 'numeric' },
  { key: 'stdCode', label: 'City STD code', placeholder: '080', keyboard: 'numeric' },
  { key: 'gps', label: 'Store location (latitude,longitude)', placeholder: '12.9716,77.5946' },
  { key: 'phone', label: 'Phone for buyers', placeholder: '98765 43210', keyboard: 'phone-pad' },
  { key: 'email', label: 'Email for buyers', placeholder: 'you@example.com', keyboard: 'email-address' },
];

/**
 * Selling on ONDC from your own profile (ADR 0015). ONDC is India's open commerce network: with a
 * store turned on, your public products priced in rupees appear in ONDC buyer apps. The store holds
 * what those apps need and a listing does not. Orders through ONDC come in a later phase.
 */
export function OndcStoreSettings() {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<SavedOndcStore | null>();
  const [draft, setDraft] = useState<OndcStore>(emptyOndcStore);
  const [errors, setErrors] = useState<OndcStoreErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (saved !== undefined) return;
    if (!apiConfigured()) { setSaved(null); setMessage('ONDC selling is unavailable right now.'); return; }
    loadOndcStore().then((store) => { setSaved(store); if (store) setDraft(store); }).catch((reason) => { setSaved(null); setMessage(reason instanceof Error ? reason.message : 'Could not load your ONDC store.'); });
  }, [saved]);

  const update = <K extends keyof OndcStore>(key: K, value: OndcStore[K]) => { setDraft((current) => ({ ...current, [key]: value })); setErrors((current) => ({ ...current, [key]: undefined })); };

  const save = async (next: OndcStore) => {
    const checked = validateOndcStore(next);
    setErrors(checked.errors);
    if (Object.keys(checked.errors).length) { setMessage('Check the highlighted details.'); return; }
    setBusy(true); setMessage('');
    try {
      const store = await saveOndcStore(checked.store);
      setSaved(store); setDraft(store);
      setMessage(store.enabled ? 'Your store is on. ONDC buyer apps can find your products once Open Media joins the network.' : 'Saved. Your store is off.');
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : 'Your ONDC store could not be saved.');
    } finally { setBusy(false); }
  };

  const chips = <T extends string>(options: Record<T, string>, value: T, onChange: (next: T) => void, label: string) => <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.chips}>
    {(Object.keys(options) as T[]).map((option) => <Pressable key={option} accessibilityRole="radio" accessibilityState={{ checked: value === option }} onPress={() => onChange(option)} style={[styles.chip, value === option && styles.chipActive]}>
      <Text style={[styles.chipText, value === option && styles.chipTextActive]}>{options[option]}</Text>
    </Pressable>)}
  </View>;

  return <>
    <Text style={styles.title}>Sell on ONDC (India)</Text>
    <View style={styles.card}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen((value) => !value)} style={styles.row}>
        <Ionicons name="storefront-outline" size={20} color={colors.text} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle}>{saved?.enabled ? 'Your ONDC store is on' : 'Offer your products on ONDC'}</Text>
          <Text style={styles.hint}>India’s open commerce network. Your public products priced in rupees can appear in every ONDC buyer app.</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textTertiary} />
      </Pressable>
      {open ? saved === undefined ? <ActivityIndicator style={styles.loading} color={colors.text} /> : <View style={[styles.block, styles.divider]}>
        <View style={styles.notice}>
          <Ionicons name="information-circle-outline" size={18} color={colors.textSecondary} />
          <Text style={[styles.hint, styles.grow]}>Open Media is joining ONDC as a seller app. Until registration finishes, your store is saved but not yet visible on the network. When it is, buyer apps can show your items and prices; orders through ONDC come later, so buyers contact you to buy. Prices should include delivery.</Text>
        </View>
        {saved?.enabled ? <Text style={styles.hint}>{saved.offeredItems ?? 0} {saved.offeredItems === 1 ? 'product is' : 'products are'} offered: your public products priced in INR that aren’t sold out.</Text> : null}
        <Text style={styles.label}>Category</Text>
        {chips(ondcCategories, draft.category, (value) => update('category', value), 'Store category')}
        {fields.map((field) => <View key={field.key} style={styles.field}>
          <Text style={styles.label}>{field.label}</Text>
          <TextInput accessibilityLabel={field.label} value={draft[field.key]} onChangeText={(value) => update(field.key, value)} placeholder={field.placeholder} placeholderTextColor={colors.textTertiary}
            keyboardType={field.keyboard ?? 'default'} autoCapitalize={field.key === 'email' ? 'none' : 'words'} autoCorrect={false} style={[styles.input, errors[field.key] && styles.inputError]} />
          {errors[field.key] ? <Text style={styles.error}>{errors[field.key]}</Text> : null}
        </View>)}
        <Text style={styles.label}>Time to ship</Text>
        {chips(ondcShipTimes, draft.timeToShip, (value) => update('timeToShip', value), 'Time to ship')}
        <View style={styles.inline}>
          <Text style={[styles.rowTitle, styles.grow]}>Accept returns</Text>
          <Switch accessibilityLabel="Accept returns" value={draft.returnable} onValueChange={(value) => update('returnable', value)} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} />
        </View>
        {draft.returnable ? chips(ondcReturnWindows, draft.returnWindow, (value) => update('returnWindow', value), 'Return window') : null}
        <View style={styles.inline}>
          <Text style={[styles.rowTitle, styles.grow]}>Allow cancellation before shipping</Text>
          <Switch accessibilityLabel="Allow cancellation before shipping" value={draft.cancellable} onValueChange={(value) => update('cancellable', value)} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} />
        </View>
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: draft.declarationAccepted }} onPress={() => update('declarationAccepted', !draft.declarationAccepted)} style={styles.declaration}>
          <Ionicons name={draft.declarationAccepted ? 'checkbox' : 'square-outline'} size={20} color={errors.declarationAccepted ? colors.danger : colors.text} />
          <Text style={[styles.hint, styles.grow]}>I am responsible for the items I offer and for these details, which I confirm are accurate. My store name, address, phone and email will be shown to ONDC buyers.</Text>
        </Pressable>
        {errors.declarationAccepted ? <Text style={styles.error}>{errors.declarationAccepted}</Text> : null}
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => save({ ...draft, enabled: !draft.enabled })} style={styles.primary}>
            {busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>{draft.enabled ? 'Turn store off' : 'Turn store on'}</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" disabled={busy} onPress={() => save(draft)} style={styles.small}><Text style={styles.smallText}>Save</Text></Pressable>
        </View>
      </View> : null}
    </View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.status}>{message}</Text> : null}
  </>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    title: { marginTop: 28, marginBottom: 10, color: colors.text, fontSize: 16, fontWeight: '700' },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    loading: { padding: 16 },
    row: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
    block: { padding: 16, gap: 10 },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    grow: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    label: { color: colors.text, fontSize: 14, fontWeight: '600' },
    notice: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 12, backgroundColor: colors.surfaceAlt },
    field: { gap: 6 },
    input: { minHeight: 42, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object,
    inputError: { borderColor: colors.danger },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border },
    chipActive: { backgroundColor: colors.text, borderColor: colors.text },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: colors.surface },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40 },
    declaration: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 4 },
    actions: { flexDirection: 'row', gap: 10, alignItems: 'center', marginTop: 4 },
    primary: { minHeight: 40, paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center', borderRadius: 20, backgroundColor: colors.text },
    primaryText: { color: colors.surface, fontSize: 14, fontWeight: '700' },
    small: { minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border },
    smallText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    error: { color: colors.danger, fontSize: 12, lineHeight: 16 },
    status: { marginTop: 8, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  });
}
