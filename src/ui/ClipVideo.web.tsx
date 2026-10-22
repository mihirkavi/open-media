import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ClipVideoProps } from './ClipVideo';

/**
 * Web: a plain <video>. Safari plays HLS itself; other browsers get hls.js, loaded only when an HLS
 * clip is first shown. Muted autoplay is what browsers allow without a tap.
 */
export function ClipVideo({ uri, streaming, posterUrl, active, muted, contentFit = 'cover', onError, style }: ClipVideoProps) {
  const video = useRef<HTMLVideoElement>(null);
  const errored = useRef(false);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    errored.current = false;
    const fail = () => { if (!errored.current) { errored.current = true; onError?.(); } };
    const needsHlsJs = streaming === 'hls' && !element.canPlayType('application/vnd.apple.mpegurl');
    if (!needsHlsJs) { element.src = uri; return () => { element.removeAttribute('src'); element.load(); }; }
    let destroyed = false;
    let hls: { destroy(): void } | undefined;
    import('hls.js').then(({ default: Hls }) => {
      if (destroyed) return;
      if (!Hls.isSupported()) { fail(); return; }
      const instance = new Hls({ maxBufferLength: 20 });
      instance.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(); });
      instance.loadSource(uri);
      instance.attachMedia(element);
      hls = instance;
    }).catch(fail);
    return () => { destroyed = true; hls?.destroy(); };
  }, [uri, streaming, onError]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    element.muted = muted;
    if (active) element.play().catch(() => undefined); else element.pause();
  }, [active, muted, uri]);

  return <View style={[styles.frame, style]}>
    <video
      ref={video}
      poster={posterUrl}
      muted={muted}
      loop
      playsInline
      preload={active ? 'auto' : 'metadata'}
      onError={() => { if (!errored.current && streaming !== 'hls') { errored.current = true; onError?.(); } }}
      style={{ width: '100%', height: '100%', objectFit: contentFit, backgroundColor: '#000000', display: 'block' }}
    />
  </View>;
}

const styles = StyleSheet.create({ frame: { overflow: 'hidden', backgroundColor: '#000000' } });
