import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Image, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

export interface ClipVideoProps {
  uri: string;
  streaming?: 'hls' | 'progressive';
  posterUrl?: string;
  /** Plays while true; pauses (and keeps its place) while false. */
  active: boolean;
  muted: boolean;
  contentFit?: 'cover' | 'contain';
  /** Called once if the video can't be played, so the caller can fall back to a link. */
  onError?: () => void;
  style?: StyleProp<ViewStyle>;
}

/** iOS and Android: expo-video, which plays MP4/MOV and HLS natively. `ClipVideo.web.tsx` covers web. */
export function ClipVideo({ uri, streaming, posterUrl, active, muted, contentFit = 'cover', onError, style }: ClipVideoProps) {
  const player = useVideoPlayer({ uri, contentType: streaming ?? 'auto' }, (created) => { created.loop = true; created.muted = muted; });
  const { status } = useEvent(player, 'statusChange', { status: player.status });
  const [firstFrame, setFirstFrame] = useState(false);
  useEffect(() => { if (active) player.play(); else player.pause(); }, [active, player]);
  useEffect(() => { player.muted = muted; }, [muted, player]);
  useEffect(() => { if (status === 'error') onError?.(); }, [status, onError]);
  return <View style={[styles.frame, style]}>
    <VideoView player={player} contentFit={contentFit} nativeControls={false} onFirstFrameRender={() => setFirstFrame(true)} style={StyleSheet.absoluteFill} />
    {posterUrl && !firstFrame ? <Image source={{ uri: posterUrl }} resizeMode={contentFit} style={StyleSheet.absoluteFill} /> : null}
  </View>;
}

const styles = StyleSheet.create({ frame: { overflow: 'hidden', backgroundColor: '#000000' } });
