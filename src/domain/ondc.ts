/**
 * ONDC stores (ADR 0015): what an Open Media seller in India adds so their products can appear in
 * every ONDC buyer app. A listing already has the item, price and availability; the store adds what
 * ONDC catalogs need and a listing does not: an address with GPS and pincode, a consumer-care
 * contact, time to ship, and return and cancellation terms. Shared by the app and the Worker so
 * both validate the same way.
 */

/** Non-food retail categories that need no licence number (ONDC retail 1.2.0). */
export const ondcCategories = {
  'ONDC:RET12': 'Fashion',
  'ONDC:RET13': 'Beauty and personal care',
  'ONDC:RET14': 'Electronics',
  'ONDC:RET15': 'Appliances',
  'ONDC:RET16': 'Home and kitchen',
} as const;
export type OndcCategory = keyof typeof ondcCategories;

/** ISO 8601 durations, as ONDC expects them, with plain labels. */
export const ondcShipTimes = { PT24H: 'Within a day', P2D: 'Within 2 days', P3D: 'Within 3 days', P5D: 'Within 5 days', P7D: 'Within a week' } as const;
export const ondcReturnWindows = { P7D: '7 days', P10D: '10 days', P15D: '15 days', P30D: '30 days' } as const;
export type OndcShipTime = keyof typeof ondcShipTimes;
export type OndcReturnWindow = keyof typeof ondcReturnWindows;

export interface OndcStore {
  enabled: boolean;
  storeName: string;
  category: OndcCategory;
  building: string;
  locality: string;
  city: string;
  state: string;
  /** Six-digit PIN code. */
  areaCode: string;
  /** City STD code with its leading zero, e.g. "080" for Bengaluru. ONDC calls it std:080. */
  stdCode: string;
  /** "latitude,longitude" with up to six decimals. */
  gps: string;
  /** Ten-digit Indian mobile or landline number, shown to ONDC buyers as consumer care. */
  phone: string;
  email: string;
  timeToShip: OndcShipTime;
  returnable: boolean;
  returnWindow: OndcReturnWindow;
  cancellable: boolean;
  /** The seller confirmed they are responsible for their items and these details are accurate. */
  declarationAccepted: boolean;
  updatedAt?: string;
}

export type OndcStoreErrors = Partial<Record<keyof OndcStore, string>>;

export const emptyOndcStore: OndcStore = {
  enabled: false, storeName: '', category: 'ONDC:RET16', building: '', locality: '', city: '', state: '', areaCode: '', stdCode: '', gps: '',
  phone: '', email: '', timeToShip: 'P3D', returnable: true, returnWindow: 'P7D', cancellable: true, declarationAccepted: false,
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');

/** "+91 98765 43210" and "098765-43210" both become "9876543210". */
export function normalizeIndianPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** Parses "12.9716, 77.5946" into numbers inside India's bounding box, or undefined. */
export function parseIndianGps(value: string): { lat: number; lng: number } | undefined {
  const match = value.trim().match(/^(-?\d{1,2}(?:\.\d{1,8})?)\s*,\s*(-?\d{1,3}(?:\.\d{1,8})?)$/);
  if (!match) return undefined;
  const lat = Number(match[1]); const lng = Number(match[2]);
  return lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98 ? { lat, lng } : undefined;
}

/** Checks a store form. A store that is off may be saved incomplete; turning it on needs every field. */
export function validateOndcStore(input: Partial<Record<keyof OndcStore, unknown>>): { store: OndcStore; errors: OndcStoreErrors } {
  const gps = parseIndianGps(text(input.gps));
  const store: OndcStore = {
    enabled: input.enabled === true,
    storeName: text(input.storeName).slice(0, 80),
    category: (Object.keys(ondcCategories) as OndcCategory[]).includes(input.category as OndcCategory) ? input.category as OndcCategory : emptyOndcStore.category,
    building: text(input.building).slice(0, 120),
    locality: text(input.locality).slice(0, 120),
    city: text(input.city).slice(0, 60),
    state: text(input.state).slice(0, 60),
    areaCode: text(input.areaCode).replace(/\s/g, ''),
    stdCode: text(input.stdCode).replace(/^std:/i, '').replace(/\D/g, ''),
    gps: gps ? `${gps.lat.toFixed(6)},${gps.lng.toFixed(6)}` : text(input.gps),
    phone: normalizeIndianPhone(text(input.phone)),
    email: text(input.email).toLowerCase(),
    timeToShip: Object.keys(ondcShipTimes).includes(input.timeToShip as string) ? input.timeToShip as OndcShipTime : emptyOndcStore.timeToShip,
    returnable: input.returnable !== false,
    returnWindow: Object.keys(ondcReturnWindows).includes(input.returnWindow as string) ? input.returnWindow as OndcReturnWindow : emptyOndcStore.returnWindow,
    cancellable: input.cancellable !== false,
    declarationAccepted: input.declarationAccepted === true,
  };
  if (store.stdCode && !store.stdCode.startsWith('0')) store.stdCode = `0${store.stdCode}`;
  const errors: OndcStoreErrors = {};
  if (!store.enabled) return { store, errors };
  if (store.storeName.length < 2) errors.storeName = 'Give your store a name.';
  if (store.building.length < 2) errors.building = 'Add the building or street.';
  if (store.locality.length < 2) errors.locality = 'Add the area or locality.';
  if (store.city.length < 2) errors.city = 'Add the city.';
  if (store.state.length < 2) errors.state = 'Add the state.';
  if (!/^[1-9]\d{5}$/.test(store.areaCode)) errors.areaCode = 'Use a six-digit PIN code.';
  if (!/^0\d{2,4}$/.test(store.stdCode)) errors.stdCode = 'Use your city’s STD code, like 080 or 011.';
  if (!gps) errors.gps = 'Use latitude,longitude inside India, like 12.9716,77.5946.';
  if (!/^[2-9]\d{9}$/.test(store.phone)) errors.phone = 'Use a ten-digit Indian phone number.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(store.email)) errors.email = 'Use an email address buyers can write to.';
  if (!store.declarationAccepted) errors.declarationAccepted = 'Confirm the declaration to turn your store on.';
  return { store, errors };
}

/** ONDC prices are decimal strings in rupees: 150050 paise is "1500.50". */
export function ondcPrice(priceMinor: number): string {
  return (priceMinor / 100).toFixed(2);
}
