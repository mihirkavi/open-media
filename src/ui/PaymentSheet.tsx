import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';

import { getSupabaseClient } from '../auth/supabase';
import { browserWalletsSupported, connectBrowserWallet, sendUsdcTransfer, signWalletLink } from '../connectors/wallets/browserWallet';
import { checkPayment, linkWallet, loadPaymentOptions, loadPaymentSetup, payForListing, PaymentOptions, PaymentWithTransfer, submitTransaction } from '../data/paymentsService';
import { createClientId } from '../data/openMediaService';
import { PostListing } from '../domain/listings';
import { formatMoney, listingCharge, PaymentChain, paymentBreakdown, paymentChains, PaymentRail, paymentStatusLabels } from '../domain/payments';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { openExternal } from './PaymentsSettings';
import { Text } from './Text';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The one place Open Media adds a step on purpose: before any money moves, the person sees who is
 * paid, how much, every fee and how they pay. Card details are typed only on Stripe's page; USDC is
 * approved only in the person's own wallet.
 */
export function PaymentSheet({ postId, listing, seller, onClose }: { postId: string; listing: PostListing; seller: string; onClose: () => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [options, setOptions] = useState<PaymentOptions>();
  const [rail, setRail] = useState<PaymentRail>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [payment, setPayment] = useState<PaymentWithTransfer>();
  // One key per way of paying, so a retry never starts a second payment.
  const keys = useRef<Partial<Record<PaymentRail, string>>>({});
  const keyFor = (value: PaymentRail) => (keys.current[value] ??= createClientId());

  useEffect(() => {
    loadPaymentOptions(postId).then((next) => {
      setOptions(next);
      const usdc = next.chains.length > 0 && browserWalletsSupported();
      setRail(next.card ? 'card' : usdc ? 'onchain' : undefined);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Payment options are unavailable right now.'));
  }, [postId]);

  const chain: PaymentChain | null = options?.chains.includes('base') ? 'base' : (options?.chains[0] ?? null);
  const usdcPossible = Boolean(options?.chains.length && options.currency === 'USD');
  const preview = options?.priceMinor && rail ? listingCharge(options.priceMinor, options.currency, rail, chain, options.platformFeeBps) : undefined;

  const payByCard = async () => {
    const { payment: started, checkoutUrl } = await payForListing(postId, 'card', null, keyFor('card'));
    setPayment(started);
    if (!checkoutUrl) throw new Error('Stripe did not return a payment page.');
    await openExternal(checkoutUrl);
    setStatus('Finish paying on Stripe’s page. It shows as Paid here once Stripe confirms it.');
  };

  const payWithWallet = async () => {
    if (!chain) throw new Error('USDC payments are not available.');
    const { data } = await getSupabaseClient()!.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) throw new Error('Sign in again to pay.');
    setStatus('Connecting your wallet…');
    const wallet = await connectBrowserWallet();
    const setup = await loadPaymentSetup();
    if (!setup.wallets.some((item) => item.chain === chain && item.address === wallet.address)) {
      setStatus('Sign the message in your wallet to show the payment is from you. It costs nothing.');
      const signed = await signWalletLink(wallet, userId, chain);
      await linkWallet(signed.message, signed.signature);
    }
    const { payment: started } = await payForListing(postId, 'onchain', chain, keyFor('onchain'));
    setPayment(started);
    if (!started.transfer) throw new Error('This payment is already on its way.');
    setStatus('Approve the USDC transfer in your wallet.');
    const hash = await sendUsdcTransfer(wallet, started.transfer);
    setStatus('Checking the payment on the network…');
    let result = await submitTransaction(started.id, hash);
    for (let attempt = 0; attempt < 20 && result.payment.status === 'submitted'; attempt += 1) {
      setPayment(result.payment);
      if (result.detail) setStatus(result.detail);
      await wait(4000);
      result = await checkPayment(started.id);
    }
    setPayment(result.payment);
    setStatus(result.payment.status === 'confirmed' ? 'Paid. The seller can see it now.' : result.detail ?? paymentStatusLabels[result.payment.status]);
  };

  const confirm = async () => {
    setBusy(true); setError('');
    try { await (rail === 'card' ? payByCard() : payWithWallet()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The payment didn’t go through.'); }
    finally { setBusy(false); }
  };

  const done = payment?.status === 'confirmed';
  return <Modal visible transparent animationType="fade" onRequestClose={() => !busy && onClose()}>
    <View style={styles.backdrop}>
      <View accessibilityViewIsModal style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.heading}>{done ? 'Paid' : `Buy ${listing.title}`}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" disabled={busy} onPress={onClose} hitSlop={8}><Ionicons name="close" size={22} color={colors.text} /></Pressable>
        </View>
        {!options && !error ? <ActivityIndicator style={styles.loading} color={colors.text} /> : null}
        {options && !options.available ? <Text style={styles.hint}>This listing is sold out.</Text> : null}
        {options?.available && !rail ? <Text style={styles.hint}>{usdcPossible && !browserWalletsSupported() ? `@${seller} takes USDC. Open Open Media on the web with a browser wallet to pay.` : `@${seller} doesn’t take payments in Open Media yet. Message them instead.`}</Text> : null}
        {options?.available && rail && preview ? <>
          {options.testMode ? <View style={styles.test}><Ionicons name="flask-outline" size={15} color={colors.text} /><Text style={styles.testText}>Test mode: use a Stripe test card or test USDC. No real money moves.</Text></View> : null}
          {(options.card ? 1 : 0) + (usdcPossible && browserWalletsSupported() ? 1 : 0) > 1 ? <View style={styles.choices}>
            {([['card', 'Card'], ['onchain', 'USDC']] as const).map(([value, label]) => <Pressable key={value} accessibilityRole="radio" accessibilityState={{ checked: rail === value }} disabled={busy || Boolean(payment)} onPress={() => setRail(value)} style={[styles.choice, rail === value && styles.choiceOn]}>
              <Text style={[styles.choiceText, rail === value && styles.choiceTextOn]}>{label}</Text>
            </Pressable>)}
          </View> : null}
          <View style={styles.lines}>
            {paymentBreakdown({ ...preview, recipient: seller }).map((line) => <View key={line.label} style={styles.line}>
              <Text style={styles.lineLabel}>{line.label}</Text><Text style={styles.lineValue}>{line.value}</Text>
            </View>)}
          </View>
          {rail === 'onchain' && chain ? <Text style={styles.hint}>USDC goes from your wallet straight to @{seller} on {paymentChains[chain].name}. Payments on a blockchain can’t be reversed.</Text> : null}
          {!done ? <Pressable accessibilityRole="button" disabled={busy} onPress={confirm} style={[styles.primary, busy && styles.disabled]}>
            {busy ? <ActivityIndicator color={colors.surface} /> : <Text style={styles.primaryText}>{`Pay ${formatMoney(preview.amountMinor, preview.currency)}`}</Text>}
          </Pressable> : null}
        </> : null}
        {status ? <Text accessibilityLiveRegion="polite" style={styles.status}>{status}</Text> : null}
        {error ? <Text accessibilityLiveRegion="assertive" style={styles.error}>{error}</Text> : null}
      </View>
    </View>
  </Modal>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: { flex: 1, padding: 16, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: { width: '100%', maxWidth: 420, padding: 20, gap: 12, borderRadius: 20, backgroundColor: colors.surface },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    heading: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '700' },
    loading: { padding: 16 },
    hint: { color: colors.textSecondary, fontSize: 13, lineHeight: 18 },
    test: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 12, backgroundColor: colors.chrome },
    testText: { flex: 1, color: colors.text, fontSize: 12, lineHeight: 17 },
    choices: { flexDirection: 'row', gap: 6 },
    choice: { minHeight: 34, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 17, backgroundColor: colors.chrome },
    choiceOn: { backgroundColor: colors.text },
    choiceText: { color: colors.text, fontSize: 13, fontWeight: '600' },
    choiceTextOn: { color: colors.surface },
    lines: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4 },
    line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 8 },
    lineLabel: { flexShrink: 1, color: colors.textSecondary, fontSize: 13 },
    lineValue: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'right' },
    primary: { minHeight: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, backgroundColor: colors.text },
    primaryText: { color: colors.surface, fontSize: 15, fontWeight: '700' },
    disabled: { opacity: 0.6 },
    status: { color: colors.text, fontSize: 13, lineHeight: 18 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  });
}
