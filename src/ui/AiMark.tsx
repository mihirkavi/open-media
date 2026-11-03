import { View } from 'react-native';

/**
 * Open Media's mark for anything written by AI: three small dots, the posts it read, flowing into
 * one, the answer. Drawn with plain views so it is the same on web, iOS and Android, and always in
 * the text colour around it. Always shown next to the words “AI …”, never on its own.
 */
export function AiMark({ size = 16, color }: { size?: number; color: string }) {
  const dot = (left: number, top: number, diameter: number) => <View style={{ position: 'absolute', left: left * size, top: top * size, width: diameter * size, height: diameter * size, borderRadius: (diameter * size) / 2, backgroundColor: color }} />;
  return <View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: size, height: size }}>
    {dot(0.04, 0.08, 0.2)}
    {dot(0.04, 0.4, 0.2)}
    {dot(0.04, 0.72, 0.2)}
    {dot(0.46, 0.27, 0.46)}
  </View>;
}
