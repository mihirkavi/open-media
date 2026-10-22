import { desoPublisher } from './deso';
import { farcasterPublisher } from './farcaster';
import { hivePublisher } from './hive';
import { lensPublisher } from './lens';
import { PublishingConnector } from './types';

/** Delegated publishing for each cross-posting network, in display order. */
export const publishingConnectors: PublishingConnector[] = [farcasterPublisher, lensPublisher, hivePublisher, desoPublisher];
