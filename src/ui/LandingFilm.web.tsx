import { createElement, useEffect, useRef } from 'react';

const film = require('../../assets/landing/film.mp4');
const poster = require('../../assets/landing/film-poster.jpg');
const uri = (asset: unknown): string => typeof asset === 'string' ? asset : (asset as { uri?: string; default?: string })?.uri ?? (asset as { default?: string })?.default ?? '';

/**
 * Web: the Open Media film as the landing page's hero. It plays muted and loops, the way browsers
 * allow without a tap; the browser's own controls turn the sound on. People who ask for reduced
 * motion get the poster and press play themselves.
 */
export function LandingFilm() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element || typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    element.muted = true;
    element.play().catch(() => undefined);
  }, []);
  return createElement('video', {
    ref: video,
    src: uri(film),
    poster: uri(poster),
    muted: true,
    loop: true,
    playsInline: true,
    controls: true,
    preload: 'metadata',
    'aria-label': 'The Open Media film: one feed, one inbox and one post to every network, and the idea that the person, not the app, is the constant.',
    style: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', backgroundColor: '#000' },
  });
}
