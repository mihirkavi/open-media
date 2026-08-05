import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { mockAccounts, mockConversations } from './src/data/mockData';
import { filterConversations } from './src/domain/selectors';
import { ConversationList } from './src/ui/ConversationList';
import { SourceRail } from './src/ui/SourceRail';
import { ThreadView } from './src/ui/ThreadView';
import { colors } from './src/theme';

export default function App() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const showSourceRail = width >= 1024;
  const [accountId, setAccountId] = useState<string | 'all'>('all');
  const [query, setQuery] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(mockConversations[0].id);
  const [showThreadOnMobile, setShowThreadOnMobile] = useState(false);

  const conversations = useMemo(
    () => filterConversations(mockConversations, { accountId, query, unreadOnly }),
    [accountId, query, unreadOnly],
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
          {showSourceRail ? (
            <SourceRail
              accounts={mockAccounts}
              selectedAccountId={accountId}
              onSelectAccount={setAccountId}
            />
          ) : null}

          {(!isCompact || !showThreadOnMobile) && (
            <ConversationList
              accounts={mockAccounts}
              conversations={conversations}
              selectedId={selectedConversation?.id}
              selectedAccountId={accountId}
              query={query}
              unreadOnly={unreadOnly}
              compactAccountPicker={!showSourceRail}
              onQueryChange={setQuery}
              onToggleUnread={() => setUnreadOnly((value) => !value)}
              onSelectAccount={setAccountId}
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
  shell: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
});
