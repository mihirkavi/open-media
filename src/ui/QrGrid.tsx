import QRCode from 'qrcode';
import { useMemo } from 'react';
import { View } from 'react-native';

/** A QR code drawn with plain views, so it renders the same on web, iOS and Android. */
export function QrGrid({ value, label = 'QR code to link this account' }: { value: string; label?: string }) {
  const rows = useMemo(() => {
    const { modules } = QRCode.create(value, { errorCorrectionLevel: 'M' });
    const out: { start: number; length: number }[][] = [];
    for (let row = 0; row < modules.size; row += 1) {
      const runs: { start: number; length: number }[] = [];
      for (let column = 0; column < modules.size; column += 1) {
        if (!modules.get(row, column)) continue;
        const last = runs[runs.length - 1];
        if (last && last.start + last.length === column) last.length += 1;
        else runs.push({ start: column, length: 1 });
      }
      out.push(runs);
    }
    return out;
  }, [value]);
  const cell = Math.floor(216 / rows.length);
  const size = cell * rows.length;
  return <View accessibilityRole="image" accessibilityLabel={label} style={{ alignSelf: 'center', padding: cell * 3, backgroundColor: '#FFFFFF', borderRadius: 8 }}>
    <View style={{ width: size, height: size }}>
      {rows.map((runs, row) => runs.map((run) => <View key={`${row}-${run.start}`} style={{ position: 'absolute', top: row * cell, left: run.start * cell, width: run.length * cell, height: cell, backgroundColor: '#000000' }} />))}
    </View>
  </View>;
}
