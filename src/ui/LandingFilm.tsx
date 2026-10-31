import { Image, StyleSheet } from 'react-native';

/**
 * The landing page's hero. The phone apps open straight to the feed and never show the landing
 * page, so outside the web this is only the still poster; the film itself plays on the web.
 */
export function LandingFilm() {
  return <Image accessibilityLabel="Open Media on a phone: one feed from every open network" source={require('../../assets/landing/film-poster.jpg')} style={StyleSheet.absoluteFill} resizeMode="cover" />;
}
