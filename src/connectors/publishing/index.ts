import { blueskyPublisher } from './bluesky';
import { desoPublisher } from './deso';
import { farcasterPublisher } from './farcaster';
import { hivePublisher } from './hive';
import { lensPublisher } from './lens';
import { mastodonPublisher } from './mastodon';
import { nostrPublisher } from './nostr';
import { oauthPublisher } from './oauthNetwork';
import { oauthNetworks } from '../../domain/crossPosting';
import { PublishingConnector } from './types';

/** Delegated publishing for each cross-posting network, in display order. */
export const publishingConnectors: PublishingConnector[] = [blueskyPublisher, mastodonPublisher, nostrPublisher, farcasterPublisher, lensPublisher, hivePublisher, desoPublisher, ...oauthNetworks.map(oauthPublisher)];
