import { PropsWithChildren, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from './Text';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { VerifiedTick } from './VerifiedTick';

/**
 * What a blue tick stands for, worded only from facts Open Media actually holds. Every tick in the
 * app shows one of these on hover (web) or tap (phones), and screen readers hear `spoken`.
 */
export interface Verification {
  title: string;
  subject: string;
  proof: string;
  spoken: string;
}

/** ADR 0013: set only by the server after an ID document and live selfie check. */
export function personVerification(name: string): Verification {
  return { title: 'Verified person', subject: name, proof: 'Photo ID · live selfie', spoken: 'Identity checked with a photo ID and a live selfie.' };
}

/** Mail that passed DMARC from a domain that publishes a BIMI mark certificate. */
export function senderVerification(domain: string): Verification {
  return {
    title: 'Verified sender',
    subject: domain,
    proof: 'DMARC passed · BIMI certificate',
    spoken: `Mail passed DMARC, so it really comes from ${domain}, and its logo is backed by a BIMI mark certificate.`,
  };
}

/** ADR 0024: a listed news outlet or weather service, with the feed served from its own domain. */
export function officialFeedVerification(name: string, domain: string): Verification {
  return {
    title: 'Official feed',
    subject: domain,
    proof: `${name}’s own site`,
    spoken: `This feed is served from ${domain}, ${name}’s own domain.`,
  };
}

/**
 * A picture with the blue tick on its bottom-right corner, ringed in the page colour so it reads on
 * any photo or logo. `size` is the picture's width. The credentials card opens beside small
 * pictures and below large ones (profile headers), so it never runs off a phone screen. In
 * swipeable message rows the card stays inside the row, which clips anything outside it.
 */
export function VerifiedSeal({ verification, size, children }: PropsWithChildren<{ verification?: Verification; size: number }>) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  if (!verification) return <>{children}</>;
  const seal = Math.max(14, Math.round(size * 0.42));
  const overhang = Math.round(seal * 0.18);
  const below = size >= 64;
  return (
    <View style={[styles.frame, open && styles.raised]}>
      {children}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label(verification)}
        hitSlop={6}
        onHoverIn={() => setOpen(true)}
        onHoverOut={() => setOpen(false)}
        onPress={(event) => {
          // The picture usually opens a profile or a chat; the tick only shows its card.
          event.stopPropagation?.();
          event.preventDefault?.();
          setOpen((value) => !value);
        }}
        style={[styles.seal, { width: seal, height: seal, borderRadius: seal / 2, left: size - seal + overhang, top: size - seal + overhang }]}
      >
        <VerifiedTick size={seal - 4} label={label(verification)} />
      </Pressable>
      {open ? <CredentialsCard verification={verification} style={below ? { top: size + 8, left: size / 2 - cardWidth / 2 } : { top: Math.round(size / 2) - 32, left: size + 10 }} /> : null}
    </View>
  );
}

/**
 * The tick after a name, for places with no picture to put it on (Clips over a video, Settings
 * rows). Same hover or tap card as the seal.
 */
export function VerifiedTickWithCard({ verification, size = 14 }: { verification: Verification; size?: number }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.inline, open && styles.raised]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label(verification)}
        hitSlop={6}
        onHoverIn={() => setOpen(true)}
        onHoverOut={() => setOpen(false)}
        onPress={(event) => {
          event.stopPropagation?.();
          event.preventDefault?.();
          setOpen((value) => !value);
        }}
      >
        <VerifiedTick size={size} label={label(verification)} />
      </Pressable>
      {open ? <CredentialsCard verification={verification} style={{ top: size + 6, left: -10 }} /> : null}
    </View>
  );
}

const cardWidth = 236;

function CredentialsCard({ verification, style }: { verification: Verification; style: { top: number; left: number } }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.card, style]}>
      <View style={styles.titleLine}>
        <VerifiedTick size={13} label="" />
        <Text numberOfLines={1} style={styles.title}>{verification.title}</Text>
      </View>
      <Text numberOfLines={1} style={styles.subject}>{verification.subject}</Text>
      <Text numberOfLines={1} style={styles.proof}>{verification.proof}</Text>
    </View>
  );
}

function label(verification: Verification): string {
  return `${verification.title}: ${verification.subject}. ${verification.spoken}`;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    frame: { position: 'relative' },
    inline: { position: 'relative' },
    raised: { zIndex: 30, elevation: 30 },
    seal: { position: 'absolute', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
    card: {
      position: 'absolute',
      pointerEvents: 'none',
      width: cardWidth,
      paddingHorizontal: 11,
      paddingVertical: 8,
      gap: 2,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      boxShadow: '0 6px 20px rgba(0, 0, 0, 0.14)',
      elevation: 8,
    },
    titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1 },
    title: { flexShrink: 1, color: colors.text, fontSize: 13, fontWeight: '700' },
    subject: { color: colors.text, fontSize: 12, lineHeight: 16, fontWeight: '600' },
    proof: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  });
}
