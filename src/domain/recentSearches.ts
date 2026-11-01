/**
 * Recent searches, kept on this device for the signed-in person only and never sent anywhere.
 * The newest comes first; repeating a search moves it to the top instead of listing it twice.
 */
export const maxRecentSearches = 5;

export function rememberSearch(recent: string[], query: string): string[] {
  const value = query.trim().replace(/\s+/g, ' ');
  if (value.length < 2) return recent;
  const key = value.toLocaleLowerCase();
  return [value, ...recent.filter((item) => item.toLocaleLowerCase() !== key)].slice(0, maxRecentSearches);
}

export function recentSearchesKey(viewerId: string): string {
  return `open-media.recent-searches.v1.${viewerId}`;
}
