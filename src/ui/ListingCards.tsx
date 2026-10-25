import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, View } from 'react-native';

import { eventPriceText, eventWhen, listingCurrencies, ListingInput, listingLine, ListingRating, PostEvent, PostListing, providerName } from '../domain/listings';
import { safeHttpsUrl } from '../domain/networkPosts';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text, TextInput } from './Text';

/** A product or service inside a post: what it is, the price, where, and a way to ask about it. */
export function ListingCard({ listing, onMessage, onRate, onBuy }: { listing: PostListing; onMessage?: () => void; onRate?: (stars: number | null) => Promise<ListingRating>; onBuy?: () => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const soldOut = listing.availability === 'sold_out';
  const [rating, setRating] = useState<ListingRating>(listing.rating ?? { average: null, count: 0, mine: null });
  const [note, setNote] = useState('');
  const rate = async (stars: number) => {
    if (!onRate) return;
    setNote('');
    try { setRating(await onRate(rating.mine === stars ? null : stars)); }
    catch (reason) { setNote(reason instanceof Error ? reason.message : 'Rating didn’t work. Try again.'); }
  };
  const shown = rating.mine ?? Math.round(rating.average ?? 0);
  return <View accessibilityLabel={`${listing.kind === 'product' ? 'Product' : 'Service'}: ${listing.title}, ${listingLine(listing)}`} style={styles.card}>
    <View style={styles.cardTop}>
      <View style={styles.kind}><Ionicons name={listing.kind === 'product' ? 'pricetag-outline' : 'construct-outline'} size={13} color={colors.textSecondary} /><Text style={styles.kindText}>{listing.kind === 'product' ? 'Product' : 'Service'}</Text></View>
      {soldOut ? <Text style={styles.soldOut}>Sold out</Text> : null}
    </View>
    <Text style={styles.title}>{listing.title}</Text>
    <Text style={styles.line}>{listingLine(listing)}</Text>
    {rating.count || onRate ? <View style={styles.stars}>
      {[1, 2, 3, 4, 5].map((stars) => <Pressable key={stars} accessibilityRole="button" accessibilityLabel={`Rate ${stars} ${stars === 1 ? 'star' : 'stars'}`} accessibilityState={{ selected: rating.mine === stars, disabled: !onRate }} disabled={!onRate} onPress={() => rate(stars)} hitSlop={4}>
        <Ionicons name={stars <= shown ? 'star' : 'star-outline'} size={16} color={rating.mine ? colors.text : colors.textSecondary} />
      </Pressable>)}
      <Text style={styles.small}>{rating.count ? `${rating.average?.toFixed(1)} · ${rating.count} ${rating.count === 1 ? 'rating' : 'ratings'}${rating.mine ? ' · yours' : ''}` : 'No ratings yet'}</Text>
    </View> : null}
    {note ? <Text accessibilityLiveRegion="polite" style={styles.small}>{note}</Text> : null}
    {(onMessage || onBuy) && !soldOut ? <View style={styles.actions}>
      {onBuy && listing.priceMinor ? <Pressable accessibilityRole="button" accessibilityHint="Shows the price and fees before you pay" onPress={onBuy} style={styles.primary}><Text style={styles.primaryText}>{listing.kind === 'product' ? 'Buy' : 'Pay'}</Text></Pressable> : null}
      {onMessage ? <Pressable accessibilityRole="button" onPress={onMessage} style={onBuy && listing.priceMinor ? styles.secondary : styles.primary}><Ionicons name="chatbubble-outline" size={15} color={onBuy && listing.priceMinor ? colors.text : colors.surface} /><Text style={onBuy && listing.priceMinor ? styles.secondaryText : styles.primaryText}>{listing.kind === 'product' ? 'Message seller' : 'Ask about this'}</Text></Pressable> : null}
    </View> : null}
  </View>;
}

/** A real-world event. Registration always happens on the official page; Open Media never registers anyone. */
export function EventCard({ event }: { event: PostEvent }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const url = safeHttpsUrl(event.registrationUrl);
  const provider = providerName(event.sources[0]?.provider ?? '');
  const closed = event.availability === 'closed' || event.availability === 'sold_out';
  // The organizer is already the post's author line.
  const facts = [event.online ? 'Online' : event.place, eventPriceText(event)].filter(Boolean);
  return <View accessibilityLabel={`Event: ${event.title}, ${eventWhen(event)}`} style={styles.card}>
    <View style={styles.cardTop}>
      <View style={styles.kind}><Ionicons name="calendar-outline" size={13} color={colors.textSecondary} /><Text style={styles.kindText}>Event</Text></View>
      <Text style={styles.when}>{eventWhen(event)}</Text>
    </View>
    <Text style={styles.title}>{event.title}</Text>
    {facts.length ? <Text style={styles.line}>{facts.join(' · ')}</Text> : null}
    {event.sources.length > 1 ? <Text style={styles.small}>Listed on {event.sources.map((source) => providerName(source.provider)).join(', ')}</Text> : null}
    {url ? <Pressable accessibilityRole="link" accessibilityHint="Opens the official page" onPress={() => { Linking.openURL(url).catch(() => undefined); }} style={closed ? styles.secondary : styles.primary}>
      <Text style={closed ? styles.secondaryText : styles.primaryText}>{closed ? `See on ${provider}` : event.availability === 'waitlist' ? `Join waitlist on ${provider}` : `Register on ${provider}`}</Text>
      <Ionicons name="open-outline" size={14} color={closed ? colors.text : colors.surface} />
    </Pressable> : null}
  </View>;
}

/** The composer's listing fields: kind, title, price, where. */
export function ListingFields({ value, onChange, onRemove, disabled }: { value: ListingInput; onChange: (value: ListingInput) => void; onRemove: () => void; disabled?: boolean }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const set = (change: Partial<ListingInput>) => onChange({ ...value, ...change });
  return <View style={styles.fields}>
    <View style={styles.row}>
      {(['product', 'service'] as const).map((kind) => <Pressable key={kind} accessibilityRole="radio" accessibilityState={{ checked: value.kind === kind }} disabled={disabled} onPress={() => set({ kind })} style={[styles.chip, value.kind === kind && styles.chipOn]}>
        <Text style={[styles.chipText, value.kind === kind && styles.chipTextOn]}>{kind === 'product' ? 'Product' : 'Service'}</Text>
      </Pressable>)}
      <Pressable accessibilityRole="button" accessibilityLabel="Remove listing details" disabled={disabled} onPress={onRemove} style={styles.remove}><Ionicons name="close" size={18} color={colors.textSecondary} /></Pressable>
    </View>
    <TextInput accessibilityLabel="What you’re offering" value={value.title} onChangeText={(title) => set({ title })} maxLength={120} placeholder={value.kind === 'product' ? 'What are you selling?' : 'What service do you offer?'} placeholderTextColor={colors.textTertiary} style={styles.input} editable={!disabled} />
    <View style={styles.row}>
      <TextInput accessibilityLabel="Price" value={value.price ?? ''} onChangeText={(price) => set({ price })} keyboardType="decimal-pad" placeholder="Price (optional)" placeholderTextColor={colors.textTertiary} style={[styles.input, styles.grow]} editable={!disabled} />
      <View style={styles.currencies}>
        {listingCurrencies.slice(0, 4).map((currency) => <Pressable key={currency} accessibilityRole="radio" accessibilityState={{ checked: (value.currency ?? 'USD') === currency }} disabled={disabled} onPress={() => set({ currency })} style={[styles.chipSmall, (value.currency ?? 'USD') === currency && styles.chipOn]}>
          <Text style={[styles.chipText, (value.currency ?? 'USD') === currency && styles.chipTextOn]}>{currency}</Text>
        </Pressable>)}
      </View>
    </View>
    <View style={styles.row}>
      <TextInput accessibilityLabel="Where" value={value.location ?? ''} onChangeText={(location) => set({ location })} maxLength={120} placeholder="City or neighbourhood (optional)" placeholderTextColor={colors.textTertiary} style={[styles.input, styles.grow]} editable={!disabled} />
      <View style={styles.toggle}><Text style={styles.small}>{value.kind === 'service' ? 'Remote' : 'Ships'}</Text><Switch accessibilityLabel={value.kind === 'service' ? 'Available remotely' : 'Can ship'} value={Boolean(value.remote)} onValueChange={(remote) => set({ remote })} disabled={disabled} trackColor={{ false: colors.border, true: colors.text }} thumbColor={colors.surface} /></View>
    </View>
    <Text style={styles.small}>Shown in the Feed with your post. People can message you about it, and pay in the app once you set up payments in Profile. Never send money outside a method you trust.</Text>
  </View>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: { marginTop: 13, padding: 14, gap: 6, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
    kind: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    kindText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
    when: { color: colors.text, fontSize: 13, fontWeight: '600' },
    soldOut: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
    title: { color: colors.text, fontSize: 17, lineHeight: 23, fontWeight: '700' },
    line: { color: colors.textSecondary, fontSize: 14, lineHeight: 20 },
    small: { color: colors.textTertiary, fontSize: 12, lineHeight: 17 },
    stars: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    primary: { alignSelf: 'flex-start', marginTop: 6, minHeight: 38, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 19, backgroundColor: colors.text },
    primaryText: { color: colors.surface, fontSize: 14, fontWeight: '600' },
    secondary: { alignSelf: 'flex-start', marginTop: 6, minHeight: 38, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 19, borderWidth: 1, borderColor: colors.border },
    secondaryText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    fields: { gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceAlt },
    row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    grow: { flex: 1, minWidth: 140 },
    chip: { minHeight: 32, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 16, backgroundColor: colors.chrome },
    chipSmall: { minHeight: 32, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 16, backgroundColor: colors.chrome },
    chipOn: { backgroundColor: colors.text },
    chipText: { color: colors.text, fontSize: 13, fontWeight: '500' },
    chipTextOn: { color: colors.surface },
    currencies: { flexDirection: 'row', gap: 4 },
    remove: { marginLeft: 'auto', width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 16 },
    input: { minHeight: 42, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.text, fontSize: 15, outlineStyle: 'none' } as object,
    toggle: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  });
}
