/**
 * Open Media stores and listings as ONDC retail 1.2.0 catalogs and quotes (ADR 0015).
 *
 * Open Media is a marketplace seller app (np_type MSN): each opted-in store is a provider, its
 * public INR products are items, and the store's address is the one location. Stock is not
 * tracked, so availability follows ONDC's convention: count "99" in stock, "0" out of stock.
 * Prices include delivery, which the store screen tells sellers.
 */
import { ondcCategories, OndcCategory, ondcPrice, OndcReturnWindow, OndcShipTime } from '../../../../src/domain/ondc';

export interface CatalogItem { id: string; title: string; body: string; priceMinor: number; availability: 'available' | 'limited' | 'sold_out'; createdAt: string; updatedAt: string; posterPath: string | null }

export interface CatalogStore {
  id: string; storeName: string; category: OndcCategory; building: string; locality: string; city: string; state: string; areaCode: string; stdCode: string; gps: string;
  phone: string; email: string; timeToShip: OndcShipTime; returnable: boolean; returnWindow: OndcReturnWindow; cancellable: boolean; updatedAt: string;
  handle?: string; avatarUrl?: string | null; items?: CatalogItem[];
}

export interface ImageUrls { poster: (path: string) => string; fallback: string }

const fulfillmentId = '1';
const locationId = (store: CatalogStore) => `${store.id}-store`;
const consumerCare = (store: CatalogStore) => `${store.storeName},${store.email},${store.phone}`;
const enabled = (timestamp: string) => ({ label: 'enable', timestamp });
const maximumPerOrder = (item: CatalogItem) => (item.availability === 'limited' ? 1 : 10);
const inStock = (item: CatalogItem) => item.availability !== 'sold_out';

function itemImage(item: CatalogItem, store: CatalogStore, images: ImageUrls) {
  return item.posterPath ? images.poster(item.posterPath) : store.avatarUrl || images.fallback;
}

export function catalogItem(item: CatalogItem, store: CatalogStore, images: ImageUrls) {
  const image = itemImage(item, store, images);
  const price = ondcPrice(item.priceMinor);
  return {
    id: item.id,
    time: enabled(item.updatedAt),
    descriptor: { name: item.title, code: `5:${item.id}`, symbol: image, short_desc: item.title, long_desc: item.body.trim() || item.title, images: [image] },
    quantity: { unitized: { measure: { unit: 'unit', value: '1' } }, available: { count: inStock(item) ? '99' : '0' }, maximum: { count: inStock(item) ? String(maximumPerOrder(item)) : '0' } },
    price: { currency: 'INR', value: price, maximum_value: price },
    category_id: ondcCategories[store.category],
    fulfillment_id: fulfillmentId,
    location_id: locationId(store),
    '@ondc/org/returnable': store.returnable,
    '@ondc/org/cancellable': store.cancellable,
    '@ondc/org/return_window': store.returnWindow,
    '@ondc/org/seller_pickup_return': false,
    '@ondc/org/time_to_ship': store.timeToShip,
    '@ondc/org/available_on_cod': false,
    '@ondc/org/contact_details_consumer_care': consumerCare(store),
    '@ondc/org/statutory_reqs_packaged_commodities': {
      manufacturer_or_packer_name: store.storeName,
      manufacturer_or_packer_address: [store.building, store.locality, store.city, store.state, store.areaCode].join(', '),
      common_or_generic_name_of_commodity: item.title,
    },
  };
}

function provider(store: CatalogStore, images: ImageUrls) {
  const symbol = store.avatarUrl || images.fallback;
  return {
    id: store.id,
    time: enabled(store.updatedAt),
    descriptor: { name: store.storeName, symbol, short_desc: store.storeName, long_desc: `${store.storeName} on Open Media${store.handle ? ` (@${store.handle})` : ''}`, images: [symbol] },
    ttl: 'P1D',
    locations: [{
      id: locationId(store),
      time: { ...enabled(store.updatedAt), days: '1,2,3,4,5,6,7', schedule: { holidays: [] }, range: { start: '0000', end: '2359' } },
      gps: store.gps,
      address: { street: store.building, locality: store.locality, city: store.city, state: store.state, area_code: store.areaCode },
    }],
    fulfillments: [{ id: fulfillmentId, type: 'Delivery', contact: { phone: store.phone, email: store.email } }],
    items: (store.items ?? []).map((item) => catalogItem(item, store, images)),
  };
}

/** message.catalog for on_search. */
export function onSearchCatalog(stores: CatalogStore[], images: ImageUrls) {
  return {
    'bpp/fulfillments': [{ id: fulfillmentId, type: 'Delivery' }],
    'bpp/descriptor': {
      name: 'Open Media', symbol: images.fallback, short_desc: 'Independent sellers from Open Media', long_desc: 'Open Media is an open-source social app where people sell their own products.', images: [images.fallback],
      tags: [{ code: 'bpp_terms', list: [{ code: 'np_type', value: 'MSN' }] }],
    },
    'bpp/providers': stores.map((store) => provider(store, images)),
  };
}

export interface SelectedItem { id: string; quantity: number }
export interface QuoteItem extends CatalogItem { storeId: string; store: CatalogStore }
export interface OndcError { type: 'DOMAIN-ERROR' | 'CONTEXT-ERROR' | 'CORE-ERROR' | 'POLICY-ERROR' | 'JSON-SCHEMA-ERROR'; code: string; message: string }

/** message.order for on_select: a quote for the chosen items, or the ONDC error that explains why not. */
export function onSelectOrder(providerId: string, selected: SelectedItem[], found: QuoteItem[]): { order?: object; error?: OndcError } {
  const byId = new Map(found.map((item) => [item.id, item]));
  const missing = selected.find((item) => !byId.has(item.id));
  if (missing) return { error: { type: 'DOMAIN-ERROR', code: '30004', message: `Item ${missing.id} is no longer offered.` } };
  const store = found[0]?.store;
  if (!store || found.some((item) => item.storeId !== providerId)) return { error: { type: 'DOMAIN-ERROR', code: '30001', message: 'These items do not belong to that provider.' } };
  const unavailable = selected.filter((choice) => {
    const item = byId.get(choice.id)!;
    return !inStock(item) || choice.quantity > maximumPerOrder(item);
  });
  const lines = selected.map((choice) => {
    const item = byId.get(choice.id)!;
    const count = inStock(item) ? Math.min(choice.quantity, maximumPerOrder(item)) : 0;
    return { item, count };
  });
  const totalMinor = lines.reduce((sum, line) => sum + line.item.priceMinor * line.count, 0);
  const order = {
    provider: { id: providerId },
    items: lines.map(({ item, count }) => ({ id: item.id, fulfillment_id: fulfillmentId, quantity: { count } })),
    fulfillments: [{
      id: fulfillmentId, type: 'Delivery', '@ondc/org/provider_name': store.storeName, tracking: false, '@ondc/org/category': 'Standard Delivery', '@ondc/org/TAT': store.timeToShip,
      state: { descriptor: { code: 'Serviceable' } },
    }],
    quote: {
      price: { currency: 'INR', value: ondcPrice(totalMinor) },
      breakup: [
        ...lines.map(({ item, count }) => ({
          '@ondc/org/item_id': item.id, '@ondc/org/item_quantity': { count }, title: item.title, '@ondc/org/title_type': 'item',
          price: { currency: 'INR', value: ondcPrice(item.priceMinor * count) },
          item: { quantity: { available: { count: inStock(item) ? '99' : '0' }, maximum: { count: inStock(item) ? String(maximumPerOrder(item)) : '0' } }, price: { currency: 'INR', value: ondcPrice(item.priceMinor) } },
        })),
        { '@ondc/org/item_id': fulfillmentId, title: 'Delivery charges', '@ondc/org/title_type': 'delivery', price: { currency: 'INR', value: '0.00' } },
      ],
      ttl: 'P1D',
    },
  };
  return unavailable.length
    ? { order, error: { type: 'DOMAIN-ERROR', code: '40002', message: `Not available in that quantity: ${unavailable.map((choice) => choice.id).join(', ')}.` } }
    : { order };
}
