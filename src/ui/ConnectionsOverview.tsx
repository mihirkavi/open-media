import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { connectorCatalog } from '../connectors/catalog';
import { ConnectorDescriptor } from '../connectors/types';
import { chatNetworks, unreachableChatNetworks } from '../domain/chatNetworks';
import { crossPostNetworks, destinationNames } from '../domain/crossPosting';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { NetworkMark } from './NetworkMark';
import { Text } from './Text';
import { CrossPostNetworkState, useCrossPosting } from './useCrossPosting';

/**
 * Settings → Connections at a glance: every network Open Media can reach, as a calm grid of marks.
 * Bright marks work now; faded ones are waiting on something, said in one line underneath. Nothing
 * here is a control: connecting happens in Cross-posting and in Email & connections.
 */
type Tile = { id: string; name: string; state: 'connected' | 'ready' | 'soon' | 'no' };

export function ConnectionsOverview() {
  const { colors } = useOpenMediaTheme(); const styles = useMemo(() => createStyles(colors), [colors]);
  const crossPosting = useCrossPosting();
  const byId = new Map<string, CrossPostNetworkState>(crossPosting.networks.map((item) => [item.network, item]));
  const catalog = new Map<string, ConnectorDescriptor>(connectorCatalog.map((connector) => [connector.id, connector]));

  const social: Tile[] = [
    ...crossPostNetworks.map((id): Tile => {
      const item = byId.get(id);
      return { id, name: destinationNames[id], state: item?.account ? 'connected' : item?.availability.available === false && item.availability.setup === 'owner' ? 'soon' : 'ready' };
    }),
    ...['youtube', 'tiktok', 'snapchat'].map((id): Tile => ({ id, name: catalog.get(id)?.displayName ?? id, state: 'no' })),
  ];
  const chats: Tile[] = [
    ...chatNetworks.map((network): Tile => ({ id: network.id, name: network.name, state: catalog.get(network.id)?.status === 'available' ? 'ready' : 'soon' })),
    ...unreachableChatNetworks.filter((network) => !['Snapchat', 'TikTok'].includes(network.name)).map((network): Tile => ({ id: network.name.toLowerCase(), name: network.name, state: 'no' })),
  ];
  const email: Tile[] = ['mail-import', 'gmail', 'microsoft-graph'].map((id): Tile => {
    const connector = catalog.get(id);
    return { id, name: id === 'mail-import' ? 'Any email' : connector?.displayName ?? id, state: connector?.status === 'available' ? 'ready' : 'soon' };
  });

  const count = (tiles: Tile[], ...states: Tile['state'][]) => tiles.filter((tile) => states.includes(tile.state)).length;
  const groups = [
    { title: 'Social networks', tiles: social, note: 'Bluesky, Mastodon, Nostr, Farcaster, Lens, Hive and DeSo are in your Feed now. Faded networks turn on for posting as each approves Open Media’s app; YouTube, TikTok and Snapchat don’t offer what Open Media needs.' },
    { title: 'Chat apps', tiles: chats, note: count(chats, 'ready') ? `${count(chats, 'ready')} chat apps can join Messages now through opt-in bridges.` : `${chatNetworks.length} chat apps join Messages through opt-in bridges once Open Media’s bridge server is running. iMessage and Google Chat can’t be reached.` },
    { title: 'Email', tiles: email, note: 'Any IMAP or POP mailbox works today. Gmail and Outlook sign-in come next.' },
  ];

  return <View style={styles.wrap}>
    {groups.map((group) => <View key={group.title} style={styles.group}>
      <View style={styles.heading}>
        <Text style={styles.title}>{group.title}</Text>
        <Text style={styles.tally}>{count(group.tiles, 'connected') ? `${count(group.tiles, 'connected')} connected · ` : ''}{count(group.tiles, 'connected', 'ready')} of {group.tiles.length} ready</Text>
      </View>
      <View style={styles.grid}>
        {group.tiles.map((tile) => <View key={tile.id} accessible accessibilityLabel={`${tile.name}: ${label[tile.state]}`} style={styles.tile}>
          <View>
            <NetworkMark id={tile.id} name={tile.name} size={40} muted={tile.state === 'soon' || tile.state === 'no'} />
            {tile.state === 'connected' ? <View style={styles.dot} /> : null}
          </View>
          <Text numberOfLines={2} style={[styles.name, (tile.state === 'soon' || tile.state === 'no') && styles.nameMuted]}>{tile.name}</Text>
        </View>)}
      </View>
      <Text style={styles.note}>{group.note}</Text>
    </View>)}
  </View>;
}

const label: Record<Tile['state'], string> = { connected: 'connected', ready: 'ready to connect', soon: 'coming soon', no: 'not available' };

function createStyles(colors: ThemeColors) { return StyleSheet.create({
  wrap: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  group: { paddingHorizontal: 16, paddingVertical: 16, gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  heading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  tally: { color: colors.textTertiary, fontSize: 12, fontWeight: '500' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: 14 },
  tile: { width: 64, alignItems: 'center', gap: 6 },
  name: { maxWidth: 66, color: colors.text, fontSize: 11, lineHeight: 14, fontWeight: '500', textAlign: 'center' },
  nameMuted: { color: colors.textTertiary },
  dot: { position: 'absolute', right: -2, bottom: -2, width: 12, height: 12, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: colors.surface },
  note: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
}); }
