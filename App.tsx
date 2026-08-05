import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { mockConversations } from './src/data/mockData';
import { PeopleFilter } from './src/domain/models';
import { filterConversations } from './src/domain/selectors';
import { ConversationList } from './src/ui/ConversationList';
import { PeopleRail } from './src/ui/PeopleRail';
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

  const conversations = useMemo(
    () => filterConversations(mockConversations, { peopleFilter, query, unreadOnly }),
    [peopleFilter, query, unreadOnly],
  );
  const selectedConversation =
    mockConversations.find((conversation) => conversation.id === selectedId) ?? conversations[0];

  const openConversation = (id: string) => {
    setSelectedId(id);
    setShowThreadOnMobile(true);
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <StatusBar style="dark" />
        <View style={styles.shell}>
          {showPeopleRail ? (
            <PeopleRail
              conversations={mockConversations}
              selectedFilter={peopleFilter}
              onSelectFilter={setPeopleFilter}
            />
          ) : null}

          {(!isCompact || !showThreadOnMobile) && (
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
            />
          )}

          {(!isCompact || showThreadOnMobile) && (
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
