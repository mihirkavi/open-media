import { createContext, PropsWithChildren, RefObject, useContext, useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { useOpenMediaTheme } from '../themeContext';

/** A request to show one setting: its id in the settings graph, and when it was asked for. */
export interface SettingFocus { id: string; at: number }

interface AnchorScope { anchor?: string; at?: number; scroller: RefObject<ScrollView | null>; top: RefObject<View | null> }

const AnchorContext = createContext<AnchorScope | undefined>(undefined);

/**
 * Wraps a settings page's scrolling content. When `anchor` is set, the `SettingAnchor` with that id
 * scrolls to the top of the page and is outlined for a moment, so a search result lands on the
 * setting itself instead of the top of the page.
 */
export function SettingAnchorScope({ anchor, at, scroller, children }: PropsWithChildren<{ anchor?: string; at?: number; scroller: RefObject<ScrollView | null> }>) {
  const top = useRef<View>(null);
  return <AnchorContext.Provider value={{ anchor, at, scroller, top }}><View ref={top} collapsable={false} />{children}</AnchorContext.Provider>;
}

/** One section a search result can land on. */
export function SettingAnchor({ id, children }: PropsWithChildren<{ id: string }>) {
  const scope = useContext(AnchorContext);
  const { colors } = useOpenMediaTheme();
  const view = useRef<View>(null);
  const [lit, setLit] = useState(false);
  const wanted = Boolean(scope?.at) && scope?.anchor === id;
  useEffect(() => {
    if (!wanted || !scope) return;
    // Measured against the top of the content, not the window, so the current scroll doesn't matter.
    // Measured again once sections above have loaded their data and grown.
    const align = (animated: boolean) => scope.top.current?.measureInWindow((_x, topY) => view.current?.measureInWindow((_left, y) => {
      scope.scroller.current?.scrollTo({ y: Math.max(0, y - topY - 12), animated });
    }));
    const timers = [setTimeout(() => align(true), 60), setTimeout(() => align(false), 500), setTimeout(() => align(false), 1200)];
    setLit(true);
    const off = setTimeout(() => setLit(false), 2600);
    return () => { timers.forEach(clearTimeout); clearTimeout(off); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, scope?.at]);
  return <View ref={view} collapsable={false} style={lit ? { borderRadius: 18, outlineWidth: 2, outlineStyle: 'solid', outlineColor: colors.text, outlineOffset: 4, backgroundColor: colors.accentSoft } as object : undefined}>{children}</View>;
}
