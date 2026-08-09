import { useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { mockConversations } from './src/data/mockData';
import { PeopleFilter } from './src/domain/models';
import { filterConversations } from './src/domain/selectors';
import { normalizeSyncedEmail } from './src/domain/emailNormalization';
import { ConnectedMailAccount, SyncedMailMessage } from './src/connectors/mailApiConnector';
import { AISearchState, searchWithAppleFoundationModels } from './src/search/appleFoundationSearch';
import { ConversationList } from './src/ui/ConversationList';
import { PeopleRail } from './src/ui/PeopleRail';
import { SettingsView } from './src/ui/SettingsView';
import { ThreadView } from './src/ui/ThreadView';
import { colors } from './src/theme';

export default function App() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const showPeopleRail = width >= 1024;
  const [peopleFilter, setPeopleFilter] = useState<PeopleFilter>('all');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(mockConversations[0].id);
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiSearch, setAISearch] = useState<AISearchState>({ status: 'idle' });
  const [syncedConversations, setSyncedConversations] = useState<typeof mockConversations[number][]>([]);
  const allConversations = useMemo(() => [...syncedConversations, ...mockConversations], [syncedConversations]);

  const conversations = useMemo(
    () => filterConversations(allConversations, { peopleFilter, query, unreadOnly }),
    [allConversations, peopleFilter, query, unreadOnly],
  );
  const selectedConversation =
    allConversations.find((conversation) => conversation.id === selectedId) ?? conversations[0];

  useEffect(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      setAISearch({ status: 'idle' });
      return;
    }

    let cancelled = false;
    setAISearch({ status: 'loading' });
    const timeout = setTimeout(() => {
      searchWithAppleFoundationModels(trimmedQuery, allConversations).then((result) => {
        if (!cancelled) setAISearch(result);
      });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [allConversations, query]);

  const importSyncedMail = (account: ConnectedMailAccount, messages: SyncedMailMessage[]) => {
    const imported = normalizeSyncedEmail(account, messages);
    setSyncedConversations((current) => [...imported, ...current.filter((conversation) => !imported.some((item) => item.id === conversation.id))]);
  };

  const openConversation = (id: string) => {
    setSelectedId(id);
    setSettingsOpen(false);
    setShowThreadOnMobile(true);
  };

  const openSettings = () => {
    setSettingsOpen(true);
    setShowThreadOnMobile(false);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.shell}>
          {showPeopleRail ? (
            <PeopleRail
              conversations={allConversations}
              selectedFilter={peopleFilter}
              onSelectFilter={setPeopleFilter}
              onOpenSettings={openSettings}
            />
          ) : null}

          {(!isCompact || (!showThreadOnMobile && !settingsOpen)) && (
            <ConversationList
              conversations={conversations}
              selectedId={selectedConversation?.id}
              selectedPeopleFilter={peopleFilter}
              query={query}
              unreadOnly={unreadOnly}
              compactPeoplePicker={!showPeopleRail}
              onQueryChange={setQuery}
              onToggleUnread={() => setUnreadOnly((value) => !value)}
              onSelectPeopleFilter={setPeopleFilter}
              onSelectConversation={openConversation}
              onOpenSettings={openSettings}
              aiSearch={aiSearch}
            />
          )}

          {settingsOpen ? (
            <SettingsView isCompact={isCompact} onClose={() => setSettingsOpen(false)} onMailSynced={importSyncedMail} />
          ) : (!isCompact || showThreadOnMobile) && (
            <ThreadView
              conversation={selectedConversation}
              isCompact={isCompact}
              onBack={() => setShowThreadOnMobile(false)}
            />
          )}
        </View>
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.chrome,
    ...(Platform.OS === 'web' ? ({ minHeight: '100vh' } as object) : {}),
  },
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.surface, overflow: 'hidden' },
});
