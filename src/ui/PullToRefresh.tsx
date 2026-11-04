import { PropsWithChildren, useEffect, useRef, useState } from 'react';
import { GestureResponderEvent, Platform, RefreshControl, ScrollView, StyleProp, View, ViewStyle } from 'react-native';

import { useOpenMediaTheme } from '../themeContext';
import { Loader } from './Loader';

const trigger = 64;

/**
 * A list that refreshes when pulled down from the top. Phones use the system pull; the web has none,
 * so on touch screens the pull is followed by hand and the Open Media mark shows how far to go.
 * With a trackpad or mouse wheel, scrolling on up past the top pulls the same way, but only when
 * the scroll started at the top, so a fast scroll that merely reaches the top never refreshes.
 */
export function PullToRefresh({ onRefresh, style, contentContainerStyle, children }: PropsWithChildren<{ onRefresh?: () => Promise<void>; style?: StyleProp<ViewStyle>; contentContainerStyle?: StyleProp<ViewStyle> }>) {
  const { colors } = useOpenMediaTheme();
  const [refreshing, setRefreshing] = useState(false);
  const [pull, setPull] = useState(0);
  const top = useRef(true);
  const start = useRef<number | undefined>(undefined);
  const scroller = useRef<ScrollView>(null);
  const latest = useRef({ refresh: () => {}, refreshing });

  const refresh = () => {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    onRefresh().catch(() => undefined).finally(() => { setRefreshing(false); setPull(0); });
  };

  latest.current = { refresh, refreshing };

  useEffect(() => {
    if (Platform.OS !== 'web' || !onRefresh) return;
    const node = (scroller.current as unknown as { getScrollableNode?: () => HTMLElement | null } | null)?.getScrollableNode?.();
    if (!node) return;
    // One gesture is a run of wheel events less than 250 ms apart.
    let pulled = 0; let fromTop = false; let last = 0; let idle: ReturnType<typeof setTimeout> | undefined;
    const onWheel = (event: WheelEvent) => {
      const now = event.timeStamp;
      if (now - last > 250) { pulled = 0; fromTop = node.scrollTop <= 0; }
      last = now;
      if (!fromTop || latest.current.refreshing || event.deltaY >= 0 || node.scrollTop > 0) { if (event.deltaY > 0) fromTop = false; return; }
      pulled += -event.deltaY * 0.35;
      setPull(Math.min(trigger * 1.4, pulled));
      if (pulled >= trigger) { fromTop = false; latest.current.refresh(); return; }
      clearTimeout(idle);
      idle = setTimeout(() => { if (!latest.current.refreshing) setPull(0); }, 300);
    };
    node.addEventListener('wheel', onWheel, { passive: true });
    return () => { node.removeEventListener('wheel', onWheel); clearTimeout(idle); };
  }, [onRefresh]);

  if (Platform.OS !== 'web' || !onRefresh) {
    return <ScrollView style={style} contentContainerStyle={contentContainerStyle} refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.text} colors={[colors.text]} /> : undefined}>{children}</ScrollView>;
  }

  const y = (event: GestureResponderEvent) => event.nativeEvent.touches[0]?.pageY ?? event.nativeEvent.pageY;
  const shown = refreshing ? trigger : pull;
  return <ScrollView
    ref={scroller}
    style={style}
    contentContainerStyle={contentContainerStyle}
    scrollEventThrottle={32}
    onScroll={(event) => { top.current = event.nativeEvent.contentOffset.y <= 0; }}
    onTouchStart={(event) => { start.current = top.current && !refreshing ? y(event) : undefined; }}
    onTouchMove={(event) => { if (start.current !== undefined) setPull(Math.max(0, Math.min(trigger * 1.4, (y(event) - start.current) * 0.5))); }}
    onTouchEnd={() => { if (start.current !== undefined && pull >= trigger) refresh(); else if (!refreshing) setPull(0); start.current = undefined; }}
  >
    {shown > 4 ? <View accessibilityLiveRegion="polite" style={{ height: shown, alignItems: 'center', justifyContent: 'center', opacity: Math.min(1, shown / trigger) }}>
      <Loader color={colors.text} accessibilityLabel={refreshing ? 'Checking for new messages' : 'Pull to check for new messages'} />
    </View> : null}
    {children}
  </ScrollView>;
}
