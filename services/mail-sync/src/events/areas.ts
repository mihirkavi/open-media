/**
 * Initial geography: the South Bay and the wider San Francisco Bay Area.
 * Each place carries the slugs that Meetup and Eventbrite use on their public
 * listing pages. Add places here to widen coverage.
 */
export interface Place {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  meetup: string;
  eventbrite: string;
}

export interface Area {
  key: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  /** Listing pages to read for this area, most central first. */
  places: string[];
}

const place = (key: string, name: string, latitude: number, longitude: number, slug: string): Place => ({
  key,
  name,
  latitude,
  longitude,
  meetup: `us--ca--${slug}`,
  eventbrite: `ca--${slug}`,
});

export const PLACES: Record<string, Place> = Object.fromEntries([
  place('san_jose', 'San Jose', 37.3382, -121.8863, 'san-jose'),
  place('santa_clara', 'Santa Clara', 37.3541, -121.9552, 'santa-clara'),
  place('sunnyvale', 'Sunnyvale', 37.3688, -122.0363, 'sunnyvale'),
  place('mountain_view', 'Mountain View', 37.3861, -122.0839, 'mountain-view'),
  place('palo_alto', 'Palo Alto', 37.4419, -122.143, 'palo-alto'),
  place('menlo_park', 'Menlo Park', 37.453, -122.1817, 'menlo-park'),
  place('cupertino', 'Cupertino', 37.323, -122.0322, 'cupertino'),
  place('campbell', 'Campbell', 37.2872, -121.95, 'campbell'),
  place('los_gatos', 'Los Gatos', 37.2358, -121.9624, 'los-gatos'),
  place('milpitas', 'Milpitas', 37.4323, -121.8996, 'milpitas'),
  place('fremont', 'Fremont', 37.5485, -121.9886, 'fremont'),
  place('redwood_city', 'Redwood City', 37.4852, -122.2364, 'redwood-city'),
  place('san_mateo', 'San Mateo', 37.563, -122.3255, 'san-mateo'),
  place('san_francisco', 'San Francisco', 37.7749, -122.4194, 'san-francisco'),
  place('oakland', 'Oakland', 37.8044, -122.2712, 'oakland'),
  place('berkeley', 'Berkeley', 37.8715, -122.273, 'berkeley'),
].map((item) => [item.key, item]));

export const AREAS: Record<string, Area> = {
  south_bay: { key: 'south_bay', name: 'South Bay', latitude: 37.35, longitude: -121.96, radiusKm: 28, places: ['san_jose', 'sunnyvale', 'santa_clara'] },
  peninsula: { key: 'peninsula', name: 'Peninsula', latitude: 37.48, longitude: -122.2, radiusKm: 22, places: ['palo_alto', 'redwood_city', 'san_mateo'] },
  san_francisco: { key: 'san_francisco', name: 'San Francisco', latitude: 37.7749, longitude: -122.4194, radiusKm: 12, places: ['san_francisco'] },
  east_bay: { key: 'east_bay', name: 'East Bay', latitude: 37.75, longitude: -122.2, radiusKm: 25, places: ['oakland', 'berkeley', 'fremont'] },
  bay_area: { key: 'bay_area', name: 'San Francisco Bay Area', latitude: 37.55, longitude: -122.15, radiusKm: 65, places: ['san_jose', 'palo_alto', 'san_francisco', 'oakland'] },
};

const ALIASES: Record<string, string> = {
  'south bay': 'south_bay',
  'silicon valley': 'south_bay',
  peninsula: 'peninsula',
  sf: 'san_francisco',
  'the city': 'san_francisco',
  'east bay': 'east_bay',
  'bay area': 'bay_area',
  'sf bay area': 'bay_area',
  'san francisco bay area': 'bay_area',
};

/** Resolves a city, region or alias to an area. Unknown names return undefined. */
export function resolveArea(name: string | undefined): Area | undefined {
  if (!name) return undefined;
  const key = name.trim().toLowerCase().replace(/,?\s*(ca|california)$/, '').trim();
  const normalized = ALIASES[key] ?? key.replace(/[^a-z]+/g, '_');
  if (AREAS[normalized]) return AREAS[normalized];
  const city = PLACES[normalized];
  if (city) return { key: city.key, name: city.name, latitude: city.latitude, longitude: city.longitude, radiusKm: 15, places: [city.key] };
  return undefined;
}

export function knownAreaNames(): string[] {
  return [...Object.values(AREAS).map((area) => area.name), ...Object.values(PLACES).map((item) => item.name)];
}

/** Great-circle distance in kilometers. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Coordinates for a city name found in an event address, when it matches a known place. */
export function placeForCity(city: string | undefined): Place | undefined {
  if (!city) return undefined;
  return PLACES[city.trim().toLowerCase().replace(/[^a-z]+/g, '_')];
}
