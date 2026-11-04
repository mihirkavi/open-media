import { StyleSheet, View } from 'react-native';

/**
 * The blue tick (ADR 0013): this Open Media account was verified by the identity provider. It is
 * set only by the server and is never shown for other networks' badges. Verified email senders
 * (BIMI with a mark certificate) show the same blue tick in Messages, labelled "Verified sender",
 * and web feeds served from a major news outlet's or weather service's own domain show it labelled
 * "Official feed from …" (ADR 0024).
 *
 * Drawn from plain views so it is identical on web, iOS and Android and needs no font or SVG:
 * three rounded squares turned 0°, 30° and 60° make a soft twelve-point seal, and a bold white
 * check sits a touch above centre so it looks optically centred.
 */
export const verifiedBlue = '#1D9BF0';

const turns = ['0deg', '30deg', '60deg'];

export function VerifiedTick({ size = 15, label = 'Verified person' }: { size?: number; label?: string }) {
  const petal = Math.round(size * 0.74 * 10) / 10;
  const stroke = Math.max(1.6, size * 0.13);
  const checkWidth = size * 0.23;
  const checkHeight = size * 0.42;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={[styles.box, { width: size, height: size }]}>
      {turns.map((turn) => (
        <View key={turn} style={[styles.petal, { width: petal, height: petal, borderRadius: petal * 0.3, transform: [{ rotate: turn }] }]} />
      ))}
      <View
        style={[
          styles.check,
          {
            width: checkWidth,
            height: checkHeight,
            borderRightWidth: stroke,
            borderBottomWidth: stroke,
            borderBottomRightRadius: stroke / 2,
            marginTop: -size * 0.08,
            transform: [{ rotate: '45deg' }],
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  petal: { position: 'absolute', backgroundColor: verifiedBlue },
  check: { borderColor: '#FFFFFF' },
});
