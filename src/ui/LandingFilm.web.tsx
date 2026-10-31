import { Ionicons } from '@expo/vector-icons';
import { createElement, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

const film = require('../../assets/landing/film.mp4');
const poster = require('../../assets/landing/film-poster.jpg');
const uri = (asset: unknown): string => typeof asset === 'string' ? asset : (asset as { uri?: string; default?: string })?.uri ?? (asset as { default?: string })?.default ?? '';

/**
 * Web: the Open Media film, edge to edge, with only two quiet controls: play or pause, and sound.
 * It starts muted, the way browsers allow without a tap, and pauses while it is scrolled out of
 * view. People who ask for reduced motion get the poster and press play themselves.
 */
export function LandingFilm() {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const pausedByViewer = useRef(false);

  useEffect(() => {
    const element = video.current;
    if (!element || typeof window === 'undefined') return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    pausedByViewer.current = Boolean(reduced);
    const sync = () => setPlaying(!element.paused);
    element.addEventListener('play', sync);
    element.addEventListener('pause', sync);
    element.muted = true;
    if (!reduced) element.play().catch(() => undefined);
    // Pause while scrolled away; resume on return unless the viewer paused it.
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !pausedByViewer.current) element.play().catch(() => undefined);
      if (!entry.isIntersecting) element.pause();
    }, { threshold: 0 });
    observer?.observe(element);
    return () => { observer?.disconnect(); element.removeEventListener('play', sync); element.removeEventListener('pause', sync); };
  }, []);

  const togglePlay = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) { pausedByViewer.current = false; element.play().catch(() => undefined); }
    else { pausedByViewer.current = true; element.pause(); }
  };
  const toggleSound = () => {
    const element = video.current;
    if (!element) return;
    element.muted = !element.muted;
    setMuted(element.muted);
    if (!element.muted && element.paused) { pausedByViewer.current = false; element.play().catch(() => undefined); }
  };

  return <View style={StyleSheet.absoluteFill}>
    {createElement('video', {
      ref: video,
      src: uri(film),
      poster: uri(poster),
      muted: true,
      loop: true,
      playsInline: true,
      preload: 'metadata',
      onClick: togglePlay,
      'aria-label': 'The Open Media film: one feed, one inbox and one post to every network, and the idea that the person, not the app, is the constant.',
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000', cursor: 'pointer' },
    })}
    <View style={styles.controls}>
      <Pressable accessibilityRole="button" accessibilityLabel={playing ? 'Pause the film' : 'Play the film'} onPress={togglePlay} style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}>
        <Ionicons name={playing ? 'pause' : 'play'} size={18} color="#F2F1ED" style={playing ? undefined : styles.playNudge} />
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={muted ? 'Turn the sound on' : 'Turn the sound off'} onPress={toggleSound} style={({ pressed }) => [styles.control, pressed && styles.controlPressed]}>
        <Ionicons name={muted ? 'volume-mute' : 'volume-high'} size={18} color="#F2F1ED" />
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  controls: { position: 'absolute', right: 20, bottom: 20, flexDirection: 'row', gap: 10 },
  control: {
    width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(20, 20, 20, 0.42)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255, 255, 255, 0.22)',
    // @ts-expect-error web-only style
    backdropFilter: 'blur(14px) saturate(140%)', transitionProperty: 'background-color', transitionDuration: '160ms',
  },
  controlPressed: { backgroundColor: 'rgba(20, 20, 20, 0.62)' },
  playNudge: { marginLeft: 2 },
});
