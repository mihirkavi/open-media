import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, View } from 'react-native';

import { getSupabaseClient } from '../auth/supabase';
import { apiConfigured } from '../connectors/mailApiConnector';
import { browserWalletsSupported, connectBrowserWallet, signWalletLink } from '../connectors/wallets/browserWallet';
import { linkWallet, loadMyPayments, loadPaymentSetup, PaymentSetup, refreshPayouts, removeWallet, startPayouts } from '../data/paymentsService';
import { formatMoney, Payment, paymentChains, paymentStatusLabels } from '../domain/payments';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { Text } from './Text';

export async function openExternal(url: string) {
  if (Platform.OS === 'web') window.open(url, '_blank', 'noopener');
  else await Linking.openURL(url);
}

export function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Payments on your own profile (ADR 0013, phase 5): getting paid by card through Stripe, the
 * wallets you proved you control, and your payment history. Open Media never holds money.
 */
export function PaymentsSettings() {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [setup, setSetup] = useState<PaymentSetup>();
  const [history, setHistory] = useState<Payment[]>([]);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    if (!apiConfigured()) { setMessage('Payments are unavailable right now.'); return; }
    const [nextSetup, nextHistory] = await Promise.allSettled([loadPaymentSetup(), loadMyPayments()]);
    if (nextSetup.status === 'fulfilled') setSetup(nextSetup.value);
    else setMessage('Payments are unavailable right now.');
    if (nextHistory.status === 'fulfilled') setHistory(nextHistory.value);
  }, []);
  useEffect(() => { refresh().catch(() => undefined); }, [refresh]);

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label); setMessage('');
    try { await action(); await refresh(); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'That didn’t work. Try again.'); }
    finally { setBusy(''); }
  };

  const card = setup?.card;
  const cardReady = Boolean(card?.chargesEnabled);
  const chain = setup?.available.chains.includes('base') ? 'base' : setup?.available.chains[0];
  const linkBrowserWallet = () => run('wallet', async () => {
    const { data } = await getSupabaseClient()!.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId || !chain) throw new Error('Sign in again to link a wallet.');
    const wallet = await connectBrowserWallet();
    const signed = await signWalletLink(wallet, userId, chain);
    await linkWallet(signed.message, signed.signature);
  });

  return <>
    <Text style={styles.title}>Payments</Text>
    {setup ? <Text style={styles.copy}>{setup.available.note} Open Media never holds your money.</Text> : null}
    <View style={styles.card}>
      {setup ? <>
        <View style={styles.row}>
          <Ionicons name="card-outline" size={20} color={colors.text} />
          <View style={styles.grow}>
            <Text style={styles.rowTitle}>{cardReady ? 'Card payments on' : card ? 'Finish setting up with Stripe' : 'Get paid by card'}</Text>
            <Text style={styles.hint}>{!setup.available.card ? 'Not available yet.'
              : cardReady ? `Buyers pay on Stripe’s page and Stripe pays you out${card?.payoutsEnabled ? '' : ' once your bank details are added'}.`
              : 'Stripe collects your bank and tax details. Open Media never sees them.'}</Text>
          </View>
          {setup.available.card && !cardReady ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={() => run('payouts', async () => openExternal((await startPayouts()).url))} style={styles.small}>
            {busy === 'payouts' ? <ActivityIndicator color={colors.text} /> : <Text style={styles.smallText}>{card ? 'Continue' : 'Set up'}</Text>}
          </Pressable> : null}
          {card ? <Pressable accessibilityRole="button" accessibilityLabel="Check Stripe setup again" disabled={Boolean(busy)} onPress={() => run('refresh', refreshPayouts)} style={styles.small}>
            {busy === 'refresh' ? <ActivityIndicator color={colors.text} /> : <Ionicons name="refresh" size={16} color={colors.text} />}
          </Pressable> : null}
        </View>

        <View style={[styles.block, styles.divider]}>
          <View style={styles.inline}>
            <Ionicons name="wallet-outline" size={20} color={colors.text} />
            <View style={styles.grow}>
              <Text style={styles.rowTitle}>Wallets</Text>
              <Text style={styles.hint}>{setup.available.chains.length ? `Get paid and pay in USDC on ${setup.available.chains.map((id) => paymentChains[id].name).join(' or ')}. Your address is shown only to the people who pay you.` : 'Not available yet.'}</Text>
            </View>
          </View>
          {setup.wallets.map((wallet) => <View key={wallet.id} style={styles.walletRow}>
            <Text style={styles.mono}>{shortAddress(wallet.address)}</Text>
            <Text style={[styles.hint, styles.grow]}>{paymentChains[wallet.chain].name}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove wallet ${shortAddress(wallet.address)}`} disabled={Boolean(busy)} onPress={() => run(`w-${wallet.id}`, () => removeWallet(wallet.id))} style={styles.small}><Text style={styles.smallText}>Remove</Text></Pressable>
          </View>)}
          {chain ? browserWalletsSupported()
            ? <Pressable accessibilityRole="button" disabled={Boolean(busy)} onPress={linkBrowserWallet} style={[styles.small, styles.start]}>
              {busy === 'wallet' ? <ActivityIndicator color={colors.text} /> : <Text style={styles.smallText}>Link a browser wallet</Text>}
            </Pressable>
            : <Text style={styles.hint}>Link wallets in the Open Media web app for now.</Text> : null}
        </View>

        <View style={[styles.block, styles.divider]}>
          <Text style={styles.label}>History</Text>
          {history.length ? history.slice(0, 20).map((payment) => <View key={payment.id} style={styles.historyRow}>
            <Ionicons name={payment.direction === 'sent' ? 'arrow-up' : 'arrow-down'} size={16} color={colors.textSecondary} />
            <View style={styles.grow}>
              <Text style={styles.rowTitle} numberOfLines={1}>{payment.context.title ?? 'Payment'}</Text>
              <Text style={styles.hint}>{payment.direction === 'sent' ? `To @${payment.recipient}` : `From @${payment.payer}`} · {paymentStatusLabels[payment.status]}</Text>
            </View>
            <Text style={styles.amount}>{formatMoney(payment.amountMinor, payment.currency)}</Text>
          </View>) : <Text style={styles.hint}>No payments yet.</Text>}
        </View>
      </> : message ? null : <ActivityIndicator style={styles.loading} color={colors.text} />}
    </View>
    {message ? <Text accessibilityLiveRegion="polite" style={styles.error}>{message}</Text> : null}
  </>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    title: { marginTop: 28, marginBottom: 10, color: colors.text, fontSize: 16, fontWeight: '700' },
    copy: { marginTop: -6, marginBottom: 10, color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, overflow: 'hidden', backgroundColor: colors.surface },
    loading: { padding: 16 },
    block: { padding: 16, gap: 10 },
    divider: { borderTopWidth: 1, borderTopColor: colors.border },
    label: { color: colors.text, fontSize: 14, fontWeight: '600' },
    hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    row: { minHeight: 60, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
    inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    walletRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 30 },
    historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    grow: { flex: 1, gap: 2 },
    rowTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    mono: { color: colors.text, fontSize: 13, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, monospace' }) },
    amount: { color: colors.text, fontSize: 14, fontWeight: '600' },
    small: { minHeight: 34, paddingHorizontal: 12, justifyContent: 'center', alignItems: 'center', borderRadius: 17, borderWidth: 1, borderColor: colors.border },
    start: { alignSelf: 'flex-start', marginLeft: 30 },
    smallText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    error: { marginTop: 8, color: colors.danger, fontSize: 12, lineHeight: 18 },
  });
}
