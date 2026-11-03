/**
 * Official web feeds of major news outlets and public weather services (ADR 0024). Each feed
 * address was fetched and checked on 2026-11-02: it answered over https, was a valid feed, and had
 * items from that week. Left out on purpose: outlets with no official feed (Reuters, AP), feeds
 * that stopped updating (Wall Street Journal, last item January 2025), feeds that failed
 * (Washington Post, CNN and CBC over https), and feeds served from someone else's domain (NDTV
 * through FeedBurner).
 *
 * A feed served from one of an outlet's own domains shows the outlet's name and an official mark
 * ("Official feed from bbc.co.uk"). The mark says only where the feed came from; it is not the
 * person verification that Open Media's tick means on people (ADR 0013).
 */

export type DirectoryTopic = 'news' | 'business' | 'technology' | 'weather';

export interface Publisher {
  id: string;
  name: string;
  /** The outlet's own domains; a feed served from any of them (or a subdomain) is official. */
  domains: string[];
  region: string;
  topic: DirectoryTopic;
}

export interface DirectoryFeed { publisher: string; title: string; url: string; keywords?: string[] }

export const publishers: Publisher[] = [
  { id: 'bbc', name: 'BBC News', domains: ['bbc.co.uk', 'bbci.co.uk', 'bbc.com'], region: 'United Kingdom', topic: 'news' },
  { id: 'guardian', name: 'The Guardian', domains: ['theguardian.com'], region: 'United Kingdom', topic: 'news' },
  { id: 'independent', name: 'The Independent', domains: ['independent.co.uk'], region: 'United Kingdom', topic: 'news' },
  { id: 'sky', name: 'Sky News', domains: ['skynews.com', 'sky.com'], region: 'United Kingdom', topic: 'news' },
  { id: 'ft', name: 'Financial Times', domains: ['ft.com'], region: 'United Kingdom', topic: 'business' },
  { id: 'economist', name: 'The Economist', domains: ['economist.com'], region: 'United Kingdom', topic: 'business' },
  { id: 'nyt', name: 'The New York Times', domains: ['nytimes.com'], region: 'United States', topic: 'news' },
  { id: 'npr', name: 'NPR', domains: ['npr.org'], region: 'United States', topic: 'news' },
  { id: 'pbs', name: 'PBS NewsHour', domains: ['pbs.org'], region: 'United States', topic: 'news' },
  { id: 'cbs', name: 'CBS News', domains: ['cbsnews.com'], region: 'United States', topic: 'news' },
  { id: 'abc-us', name: 'ABC News', domains: ['abcnews.go.com', 'abcnews.com'], region: 'United States', topic: 'news' },
  { id: 'nbc', name: 'NBC News', domains: ['nbcnews.com'], region: 'United States', topic: 'news' },
  { id: 'fox', name: 'Fox News', domains: ['foxnews.com'], region: 'United States', topic: 'news' },
  { id: 'latimes', name: 'Los Angeles Times', domains: ['latimes.com'], region: 'United States', topic: 'news' },
  { id: 'time', name: 'TIME', domains: ['time.com'], region: 'United States', topic: 'news' },
  { id: 'atlantic', name: 'The Atlantic', domains: ['theatlantic.com'], region: 'United States', topic: 'news' },
  { id: 'politico', name: 'Politico', domains: ['politico.com'], region: 'United States', topic: 'news' },
  { id: 'axios', name: 'Axios', domains: ['axios.com'], region: 'United States', topic: 'news' },
  { id: 'propublica', name: 'ProPublica', domains: ['propublica.org'], region: 'United States', topic: 'news' },
  { id: 'bloomberg', name: 'Bloomberg', domains: ['bloomberg.com'], region: 'United States', topic: 'business' },
  { id: 'aljazeera', name: 'Al Jazeera', domains: ['aljazeera.com'], region: 'Qatar', topic: 'news' },
  { id: 'dw', name: 'DW', domains: ['dw.com'], region: 'Germany', topic: 'news' },
  { id: 'france24', name: 'France 24', domains: ['france24.com'], region: 'France', topic: 'news' },
  { id: 'lemonde', name: 'Le Monde', domains: ['lemonde.fr'], region: 'France', topic: 'news' },
  { id: 'euronews', name: 'Euronews', domains: ['euronews.com'], region: 'Europe', topic: 'news' },
  { id: 'abc-au', name: 'ABC News Australia', domains: ['abc.net.au'], region: 'Australia', topic: 'news' },
  { id: 'toi', name: 'The Times of India', domains: ['indiatimes.com'], region: 'India', topic: 'news' },
  { id: 'hindu', name: 'The Hindu', domains: ['thehindu.com'], region: 'India', topic: 'news' },
  { id: 'ht', name: 'Hindustan Times', domains: ['hindustantimes.com'], region: 'India', topic: 'news' },
  { id: 'indian-express', name: 'The Indian Express', domains: ['indianexpress.com'], region: 'India', topic: 'news' },
  { id: 'mint', name: 'Mint', domains: ['livemint.com'], region: 'India', topic: 'business' },
  { id: 'dawn', name: 'Dawn', domains: ['dawn.com'], region: 'Pakistan', topic: 'news' },
  { id: 'japantimes', name: 'The Japan Times', domains: ['japantimes.co.jp'], region: 'Japan', topic: 'news' },
  { id: 'scmp', name: 'South China Morning Post', domains: ['scmp.com'], region: 'Hong Kong', topic: 'news' },
  { id: 'straits', name: 'The Straits Times', domains: ['straitstimes.com'], region: 'Singapore', topic: 'news' },
  { id: 'cna', name: 'CNA', domains: ['channelnewsasia.com'], region: 'Singapore', topic: 'news' },
  { id: 'techcrunch', name: 'TechCrunch', domains: ['techcrunch.com'], region: 'United States', topic: 'technology' },
  { id: 'verge', name: 'The Verge', domains: ['theverge.com'], region: 'United States', topic: 'technology' },
  { id: 'ars', name: 'Ars Technica', domains: ['arstechnica.com'], region: 'United States', topic: 'technology' },
  { id: 'wired', name: 'WIRED', domains: ['wired.com'], region: 'United States', topic: 'technology' },
  { id: 'nws', name: 'National Weather Service', domains: ['weather.gov'], region: 'United States', topic: 'weather' },
  { id: 'metoffice', name: 'Met Office', domains: ['metoffice.gov.uk'], region: 'United Kingdom', topic: 'weather' },
];

export const directoryFeeds: DirectoryFeed[] = [
  { publisher: 'bbc', title: 'BBC News: Top stories', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { publisher: 'bbc', title: 'BBC News: World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', keywords: ['world'] },
  { publisher: 'guardian', title: 'The Guardian: World', url: 'https://www.theguardian.com/world/rss', keywords: ['world'] },
  { publisher: 'guardian', title: 'The Guardian: UK', url: 'https://www.theguardian.com/uk/rss', keywords: ['uk'] },
  { publisher: 'guardian', title: 'The Guardian: US', url: 'https://www.theguardian.com/us/rss', keywords: ['us'] },
  { publisher: 'independent', title: 'The Independent', url: 'https://www.independent.co.uk/news/rss' },
  { publisher: 'sky', title: 'Sky News', url: 'https://feeds.skynews.com/feeds/rss/home.xml' },
  { publisher: 'ft', title: 'Financial Times', url: 'https://www.ft.com/rss/home' },
  { publisher: 'economist', title: 'The Economist: Latest', url: 'https://www.economist.com/latest/rss.xml' },
  { publisher: 'nyt', title: 'The New York Times: Top stories', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', keywords: ['nyt'] },
  { publisher: 'npr', title: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
  { publisher: 'pbs', title: 'PBS NewsHour: Headlines', url: 'https://www.pbs.org/newshour/feeds/rss/headlines' },
  { publisher: 'cbs', title: 'CBS News: Latest', url: 'https://www.cbsnews.com/latest/rss/main' },
  { publisher: 'abc-us', title: 'ABC News: Top stories', url: 'https://abcnews.go.com/abcnews/topstories' },
  { publisher: 'nbc', title: 'NBC News', url: 'https://feeds.nbcnews.com/nbcnews/public/news' },
  { publisher: 'fox', title: 'Fox News: Latest', url: 'https://moxie.foxnews.com/google-publisher/latest.xml' },
  { publisher: 'latimes', title: 'Los Angeles Times: World & Nation', url: 'https://www.latimes.com/world-nation/rss2.0.xml', keywords: ['la times'] },
  { publisher: 'time', title: 'TIME', url: 'https://time.com/feed/' },
  { publisher: 'atlantic', title: 'The Atlantic', url: 'https://www.theatlantic.com/feed/all/' },
  { publisher: 'politico', title: 'Politico: Politics', url: 'https://rss.politico.com/politics-news.xml', keywords: ['politics'] },
  { publisher: 'axios', title: 'Axios', url: 'https://api.axios.com/feed/' },
  { publisher: 'propublica', title: 'ProPublica', url: 'https://www.propublica.org/feeds/propublica/main', keywords: ['investigations'] },
  { publisher: 'bloomberg', title: 'Bloomberg: Markets', url: 'https://feeds.bloomberg.com/markets/news.rss', keywords: ['markets', 'finance'] },
  { publisher: 'aljazeera', title: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', keywords: ['world', 'middle east'] },
  { publisher: 'dw', title: 'DW: All news', url: 'https://rss.dw.com/rdf/rss-en-all', keywords: ['deutsche welle', 'germany', 'world'] },
  { publisher: 'france24', title: 'France 24', url: 'https://www.france24.com/en/rss', keywords: ['world'] },
  { publisher: 'lemonde', title: 'Le Monde in English', url: 'https://www.lemonde.fr/en/rss/une.xml' },
  { publisher: 'euronews', title: 'Euronews', url: 'https://www.euronews.com/rss', keywords: ['europe'] },
  { publisher: 'abc-au', title: 'ABC News Australia: Just in', url: 'https://www.abc.net.au/news/feed/2942460/rss.xml' },
  { publisher: 'toi', title: 'The Times of India: Top stories', url: 'https://timesofindia.indiatimes.com/rssfeedstopstories.cms', keywords: ['toi'] },
  { publisher: 'hindu', title: 'The Hindu', url: 'https://www.thehindu.com/news/feeder/default.rss' },
  { publisher: 'ht', title: 'Hindustan Times: Latest', url: 'https://www.hindustantimes.com/feeds/rss/latest/rssfeed.xml' },
  { publisher: 'indian-express', title: 'The Indian Express', url: 'https://indianexpress.com/feed/' },
  { publisher: 'mint', title: 'Mint: News', url: 'https://www.livemint.com/rss/news', keywords: ['livemint', 'markets'] },
  { publisher: 'dawn', title: 'Dawn', url: 'https://www.dawn.com/feeds/home' },
  { publisher: 'japantimes', title: 'The Japan Times', url: 'https://www.japantimes.co.jp/feed/' },
  { publisher: 'scmp', title: 'South China Morning Post', url: 'https://www.scmp.com/rss/91/feed', keywords: ['china', 'hong kong'] },
  { publisher: 'straits', title: 'The Straits Times: World', url: 'https://www.straitstimes.com/news/world/rss.xml' },
  { publisher: 'cna', title: 'CNA: Latest', url: 'https://www.channelnewsasia.com/rssfeeds/8395986', keywords: ['channel news asia'] },
  { publisher: 'techcrunch', title: 'TechCrunch', url: 'https://techcrunch.com/feed/', keywords: ['startups'] },
  { publisher: 'verge', title: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  { publisher: 'ars', title: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  { publisher: 'wired', title: 'WIRED', url: 'https://www.wired.com/feed/rss' },
  { publisher: 'metoffice', title: 'Met Office: UK weather warnings', url: 'https://www.metoffice.gov.uk/public/data/PWSCache/WarningsRSS/Region/UK', keywords: ['uk', 'britain', 'england', 'scotland', 'wales', 'northern ireland', 'warnings'] },
];

/** US states and territories for the National Weather Service's alert feeds (`area=` codes). */
export const nwsAreas: [string, string][] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['PR', 'Puerto Rico'], ['GU', 'Guam'], ['VI', 'US Virgin Islands'], ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands'],
];

export function nwsAlertFeed(code: string, name: string): DirectoryFeed {
  return { publisher: 'nws', title: `NWS alerts: ${name}`, url: `https://api.weather.gov/alerts/active.atom?area=${code}` };
}

function hostIn(host: string, domain: string) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** The outlet or weather service whose own domain serves this feed, if any. */
export function officialPublisher(feedUrl: string): (Publisher & { domain: string }) | undefined {
  let host: string;
  try {
    const url = new URL(feedUrl);
    if (url.protocol !== 'https:') return undefined;
    host = url.hostname.toLowerCase();
  } catch { return undefined; }
  for (const publisher of publishers) {
    const domain = publisher.domains.find((item) => hostIn(host, item));
    if (domain) return { ...publisher, domain };
  }
  return undefined;
}

/**
 * The listed feed for a listed outlet's home page ("bbc.co.uk", "https://www.nytimes.com/"), so a
 * site whose home page names no feed still finds its official one. Other pages are left to discovery.
 */
export function directoryFeedForSite(siteUrl: string): DirectoryFeed | undefined {
  const publisher = officialPublisher(siteUrl);
  if (!publisher || new URL(siteUrl).pathname.replace(/\/+$/, '') !== '') return undefined;
  return directoryFeeds.find((feed) => feed.publisher === publisher.id);
}

export function publisherById(id: string): Publisher | undefined {
  return publishers.find((publisher) => publisher.id === id);
}

const topicWords: Record<DirectoryTopic, RegExp> = {
  news: /\b(news|headlines|newspapers?|channels?|world)\b/,
  business: /\b(business|markets?|finance|economy)\b/,
  technology: /\b(tech|technology|gadgets|startups?)\b/,
  weather: /\b(weather|alerts?|warnings?|storms?|forecasts?)\b/,
};

/**
 * Directory feeds a search names: an outlet ("bbc", "the hindu"), a place ("news india",
 * "weather california", "weather uk") or a topic ("tech news"). Empty when nothing fits.
 */
export function searchWebFeedDirectory(query: string, limit = 6): (DirectoryFeed & { publisherName: string })[] {
  const text = ` ${query.toLocaleLowerCase().replace(/[^\p{L}\p{N}\s.]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;
  if (text.trim().length < 2) return [];
  const named = (phrase: string) => phrase.length >= 2 && text.includes(` ${phrase.toLocaleLowerCase()} `);
  const scored: { feed: DirectoryFeed; score: number }[] = [];
  const wantsWeather = topicWords.weather.test(text);
  let nwsMatched = false;
  if (wantsWeather) {
    for (const [code, name] of nwsAreas) {
      if (named(name) || (code !== 'IN' && code !== 'OR' && code !== 'ME' && code !== 'AS' && named(code))) { scored.push({ feed: nwsAlertFeed(code, name), score: 10 }); nwsMatched = true; }
    }
  }
  for (const feed of directoryFeeds) {
    const publisher = publisherById(feed.publisher)!;
    let score = 0;
    const bareName = publisher.name.replace(/^the /i, '');
    if (named(publisher.name) || named(bareName) || publisher.domains.some((domain) => named(domain) || named(domain.split('.')[0])) || named(publisher.id)) score += 8;
    if (feed.keywords?.some((keyword) => named(keyword))) score += publisher.topic === 'weather' ? (wantsWeather ? 6 : 0) : 3;
    if (named(publisher.region) || (publisher.region === 'United States' && (named('us') || named('usa') || named('america'))) || (publisher.region === 'United Kingdom' && (named('uk') || named('britain')))) score += 2;
    if (topicWords[publisher.topic].test(text) || (publisher.topic === 'business' && topicWords.news.test(text))) score += 3;
    // A US state's alerts make the UK's warnings beside the point, unless the UK was named too.
    if (publisher.id === 'metoffice' && nwsMatched && score < 6) score = 0;
    if (publisher.topic === 'weather' && !wantsWeather && score < 8) score = 0;
    if (publisher.topic !== 'weather' && wantsWeather && score < 8) score = 0;
    // A region or topic alone needs the word "news" (or another topic) with it, so "india" stays a normal search.
    if (score > 0 && score < 3) score = 0;
    if (score) scored.push({ feed, score });
  }
  // One feed per outlet unless the outlet was named, so a search like "news" shows a spread.
  const shown = new Set<string>();
  return scored.sort((a, b) => b.score - a.score)
    .filter(({ feed, score }) => score >= 8 || (shown.has(feed.publisher) ? false : (shown.add(feed.publisher), true)))
    .slice(0, limit).map(({ feed }) => ({ ...feed, publisherName: publisherById(feed.publisher)!.name }));
}
