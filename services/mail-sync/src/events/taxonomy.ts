/**
 * Interest and format vocabulary used for provider routing and explainable
 * ranking. These are transparent heuristics over public event text, not
 * measurements of who will attend.
 */
export interface Interest {
  key: string;
  label: string;
  terms: string[];
  /** Meetup topic slugs that exist on Meetup's public find pages. */
  meetupTopics: string[];
  /** Eventbrite browse-page keyword slug. */
  eventbriteTopic?: string;
}

export const INTERESTS: Interest[] = [
  { key: 'entrepreneurship', label: 'Entrepreneurship', terms: ['founder', 'founders', 'startup', 'start-up', 'entrepreneur', 'venture', 'vc', 'investor', 'pitch', 'demo day', 'accelerator', 'yc', 'bootstrapp'], meetupTopics: ['entrepreneurship', 'technology-startups'], eventbriteTopic: 'startup' },
  { key: 'artificial_intelligence', label: 'AI', terms: ['ai', 'a.i.', 'artificial intelligence', 'machine learning', 'ml', 'llm', 'agent', 'agents', 'genai', 'generative', 'deep learning', 'data science'], meetupTopics: ['data-science', 'technology'], eventbriteTopic: 'ai' },
  { key: 'wireless_technology', label: 'Wireless and RF', terms: ['wireless', 'rf', 'radio', '5g', '6g', 'antenna', 'semiconductor', 'ieee', 'signal processing', 'communications', 'chip'], meetupTopics: ['technology', 'robotics'], eventbriteTopic: 'engineering' },
  { key: 'software_engineering', label: 'Software engineering', terms: ['software', 'developer', 'engineering', 'hackathon', 'coding', 'programming', 'open source', 'python', 'devops', 'cloud'], meetupTopics: ['computer-programming', 'python'], eventbriteTopic: 'tech' },
  { key: 'professional_networking', label: 'Professional networking', terms: ['networking', 'professionals', 'career', 'industry', 'leadership', 'mixer'], meetupTopics: ['professional-networking', 'young-professionals'], eventbriteTopic: 'networking' },
  { key: 'meaningful_friendships', label: 'Friendships', terms: ['friends', 'friendship', 'meet new people', 'newcomers', 'community', 'social club', 'make friends', 'connection'], meetupTopics: ['meeting-new-people-making-friends', '20s-30s-social', 'social'], eventbriteTopic: 'social' },
  { key: 'social_activities', label: 'Social activities', terms: ['social', 'party', 'hangout', 'game night', 'trivia', 'karaoke', 'brunch', 'happy hour', 'potluck'], meetupTopics: ['social', 'social-activities'], eventbriteTopic: 'social' },
  { key: 'dating', label: 'Dating', terms: ['singles', 'speed dating', 'dating', 'single professionals', 'matchmaking'], meetupTopics: ['singles-20s-30s', 'dating-and-relationships'], eventbriteTopic: 'singles' },
  { key: 'soccer', label: 'Soccer', terms: ['soccer', 'futsal', 'football club'], meetupTopics: ['pickupsoccer', 'soccer'], eventbriteTopic: 'soccer' },
  { key: 'volleyball', label: 'Volleyball', terms: ['volleyball', 'beach volleyball'], meetupTopics: ['volleyball', 'outdoor-volleyball'], eventbriteTopic: 'volleyball' },
  { key: 'hiking', label: 'Hiking', terms: ['hike', 'hiking', 'trail', 'trek', 'outdoors', 'nature walk'], meetupTopics: ['hiking', 'hiking-for-beginners'], eventbriteTopic: 'hiking' },
  { key: 'fitness', label: 'Fitness', terms: ['fitness', 'workout', 'run club', 'running', 'yoga', 'bootcamp', 'climbing', 'bouldering'], meetupTopics: ['fitness', 'running'], eventbriteTopic: 'fitness' },
  { key: 'dance', label: 'Dancing', terms: ['dance', 'dancing', 'salsa', 'bachata', 'swing', 'ballroom'], meetupTopics: ['dancing', 'salsa'], eventbriteTopic: 'dance' },
  { key: 'games', label: 'Board games', terms: ['board game', 'board games', 'tabletop', 'chess', 'mahjong', 'dnd'], meetupTopics: ['board-games', 'games'], eventbriteTopic: 'board-games' },
  { key: 'language_exchange', label: 'Language exchange', terms: ['language exchange', 'conversation club', 'spanish', 'french', 'japanese'], meetupTopics: ['language-exchange'], eventbriteTopic: 'language-exchange' },
  { key: 'volunteering', label: 'Volunteering', terms: ['volunteer', 'volunteering', 'cleanup', 'nonprofit', 'service'], meetupTopics: ['volunteering'], eventbriteTopic: 'volunteer' },
  { key: 'arts_culture', label: 'Arts and culture', terms: ['art', 'museum', 'gallery', 'film', 'music', 'concert', 'theater', 'comedy', 'improv', 'cooking class', 'photography', 'book club'], meetupTopics: ['art-culture', 'book-clubs'], eventbriteTopic: 'arts' },
];

export function interestByKey(key: string): Interest | undefined {
  const normalized = key.trim().toLowerCase().replace(/[^a-z]+/g, '_');
  return INTERESTS.find((interest) => interest.key === normalized || interest.label.toLowerCase().replace(/[^a-z]+/g, '_') === normalized
    || interest.terms.includes(key.trim().toLowerCase()));
}

/** Interests whose terms appear in free text (e.g. a spoken request). */
export function interestsInText(text: string): Interest[] {
  const lower = ` ${text.toLowerCase()} `;
  return INTERESTS.filter((interest) => interest.terms.some((term) => containsTerm(lower, term)));
}

export function containsTerm(lowerText: string, term: string): boolean {
  const escaped = term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(lowerText);
}

/** Event formats, with how much room each usually leaves for real conversation (0–1). */
export const FORMATS: Array<{ key: string; terms: string[]; conversation: number }> = [
  { key: 'dinner', terms: ['dinner', 'supper club', 'potluck', 'brunch', 'lunch'], conversation: 0.95 },
  { key: 'small_group', terms: ['small group', 'roundtable', 'circle', 'intimate', 'limited to', 'cohort', 'salon'], conversation: 0.95 },
  { key: 'discussion', terms: ['discussion', 'fireside', 'conversation', 'book club', 'debate', 'ama', 'q&a'], conversation: 0.85 },
  { key: 'workshop', terms: ['workshop', 'class', 'hands-on', 'masterclass', 'lesson', 'bootcamp'], conversation: 0.75 },
  { key: 'activity', terms: ['hike', 'hiking', 'game night', 'board game', 'volleyball', 'soccer', 'run', 'climb', 'volunteer', 'dance', 'cooking', 'walk'], conversation: 0.8 },
  { key: 'hackathon', terms: ['hackathon', 'build day', 'buildathon', 'jam'], conversation: 0.7 },
  { key: 'meetup', terms: ['meetup', 'meet-up', 'community night'], conversation: 0.65 },
  { key: 'talk', terms: ['talk', 'lecture', 'panel', 'keynote', 'seminar', 'speaker', 'symposium', 'webinar'], conversation: 0.35 },
  { key: 'mixer', terms: ['mixer', 'happy hour', 'networking night', 'speed networking', 'cocktail'], conversation: 0.4 },
  { key: 'party', terms: ['party', 'nightlife', 'club night', 'rave', 'bar crawl'], conversation: 0.3 },
  { key: 'conference', terms: ['conference', 'summit', 'expo', 'convention', 'trade show', 'festival'], conversation: 0.3 },
  { key: 'performance', terms: ['concert', 'show', 'performance', 'screening', 'comedy show'], conversation: 0.2 },
];

export const RECURRING_TERMS = ['weekly', 'every week', 'biweekly', 'monthly', 'every month', 'every tuesday', 'every wednesday', 'every thursday', 'every saturday', 'every sunday', 'regulars', 'recurring', 'league', 'club', 'series', 'season'];

export const DATING_TERMS = ['singles', 'speed dating', 'dating', 'matchmaking'];
