/**
 * The message media picker (ADR 0029): emoji, GIFs, stickers and your avatar stickers, in one
 * panel that opens from the composer's smile. Emoji go into what you're writing; a GIF or sticker
 * sends the moment you choose it, as in other chat apps.
 */
import Ionicons from "./Icon";
import { useThemedStyles } from './useThemedStyles';
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, FlatList, Image, LayoutChangeEvent, Platform, Pressable, ScrollView, StyleSheet, View, ViewToken } from "react-native";
import { GifsUnavailable, MediaPreferences, loadMediaPreferences, saveMediaPreferences, searchGifs, withRecentEmoji } from "../data/messageMediaService";
import {
  EmojiRow, GifResult, SkinTone, StickerRow, avatarExpressions, avatarStickerURL, gifPreviewURL, gifURL, newAvatarSeed,
  skinToneSwatches, stickerURL, withSkinTone,
} from "../domain/messageMedia";
import { emojiGroups, searchEmoji, searchStickers, stickerCategories } from "../domain/messageMediaCatalog";
import { ThemeColors } from "../theme";
import { useOpenMediaTheme } from "../themeContext";
import { Loader } from "./Loader";
import { Text, TextInput } from "./Text";

type Tab = "emoji" | "gifs" | "stickers" | "me";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "emoji", label: "Emoji" },
  { id: "gifs", label: "GIFs" },
  { id: "stickers", label: "Stickers" },
  { id: "me", label: "Me" },
];

const groupIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  Recent: "time-outline",
  Smileys: "happy-outline",
  People: "hand-left-outline",
  "Animals & nature": "leaf-outline",
  "Food & drink": "cafe-outline",
  "Travel & places": "airplane-outline",
  Activities: "football-outline",
  Objects: "bulb-outline",
  Symbols: "heart-outline",
  Flags: "flag-outline",
};

const gifIdeas = ["Thank you", "LOL", "Yes", "Love", "Congrats", "Hi", "OMG", "Sad", "Dance", "Mind blown", "Good night", "Nope"];

export function MediaPicker({
  emojiOnly = false,
  compact,
  onEmoji,
  onMedia,
}: {
  /** Only emoji, where a GIF would not make sense (Open Media AI). */
  emojiOnly?: boolean;
  compact: boolean;
  onEmoji: (emoji: string) => void;
  onMedia: (url: string) => void;
}) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const [tab, setTab] = useState<Tab>("emoji");
  const [preferences, setPreferences] = useState<MediaPreferences>();
  useEffect(() => { loadMediaPreferences().then(setPreferences); }, []);
  const update = (change: Partial<MediaPreferences>) => setPreferences((current) => {
    if (!current) return current;
    const next = { ...current, ...change };
    saveMediaPreferences(next);
    return next;
  });

  // The panel rises into place, unless the person prefers less motion.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (!active) return;
      if (reduce) rise.setValue(1);
      else Animated.timing(rise, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== "web" }).start();
    }, () => rise.setValue(1));
    return () => { active = false; };
  }, [rise]);

  const visibleTabs = emojiOnly ? tabs.slice(0, 1) : tabs;
  return (
    <Animated.View
      accessibilityLabel="Emoji, GIFs and stickers"
      style={[
        styles.panel,
        { height: compact ? 320 : 360 },
        { opacity: rise, transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
      ]}
    >
      {visibleTabs.length > 1 ? (
        <View accessibilityRole="tablist" style={styles.tabs}>
          {visibleTabs.map((item) => {
            const active = item.id === tab;
            return (
              <Pressable
                key={item.id}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(item.id)}
                style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.tab, active && styles.tabActive, !active && hovered && styles.tabHover]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={styles.body}>
        {tab === "emoji" ? (
          <EmojiTab
            preferences={preferences}
            onPick={(emoji) => { onEmoji(emoji); if (preferences) update({ recentEmoji: withRecentEmoji(preferences.recentEmoji, emoji) }); }}
            onSkinTone={(skinTone) => update({ skinTone })}
          />
        ) : tab === "gifs" ? (
          <GifTab kind="gifs" compact={compact} onPick={onMedia} />
        ) : tab === "stickers" ? (
          <StickerTab compact={compact} onPick={onMedia} />
        ) : (
          <AvatarTab seed={preferences?.avatarSeed} onSeed={(avatarSeed) => update({ avatarSeed })} onPick={onMedia} />
        )}
      </View>
    </Animated.View>
  );
}

// ── Search field ─────────────────────────────────────────────────────────────────────────────

function SearchField({ value, onChange, placeholder, children }: React.PropsWithChildren<{ value: string; onChange: (value: string) => void; placeholder: string }>) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.searchRow}>
      <View style={styles.search}>
        <Ionicons name="search" size={15} color={colors.textTertiary} />
        <TextInput
          accessibilityLabel={placeholder}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          placeholderTextColor={colors.textTertiary}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          style={styles.searchInput}
        />
        {value ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" hitSlop={8} onPress={() => onChange("")}>
            <Ionicons name="close-circle" size={16} color={colors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

// ── Emoji ────────────────────────────────────────────────────────────────────────────────────

type EmojiListItem = { key: string; kind: "header"; title: string; group: string } | { key: string; kind: "row"; cells: Array<{ emoji: string; label: string }>; group: string };

const headerHeight = 30;

function EmojiTab({ preferences, onPick, onSkinTone }: { preferences?: MediaPreferences; onPick: (emoji: string) => void; onSkinTone: (tone: SkinTone) => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState(0);
  const [activeGroup, setActiveGroup] = useState("Smileys");
  const [choosingTone, setChoosingTone] = useState(false);
  const list = useRef<FlatList<EmojiListItem>>(null);
  const tone = preferences?.skinTone ?? 0;
  const recent = preferences?.recentEmoji ?? [];
  const columns = Math.max(7, Math.floor((width - 12) / 44));
  const cell = width ? (width - 12) / columns : 44;

  const { items, offsets, groupIndex } = useMemo(() => {
    const items: EmojiListItem[] = [];
    const offsets: number[] = [];
    const groupIndex = new Map<string, number>();
    let offset = 0;
    const push = (item: EmojiListItem) => { offsets.push(offset); offset += item.kind === "header" ? headerHeight : cell; items.push(item); };
    const sections: Array<{ name: string; cells: Array<{ emoji: string; label: string }> }> = [];
    if (recent.length) sections.push({ name: "Recent", cells: recent.map((emoji) => ({ emoji, label: emoji })) });
    for (const group of emojiGroups) sections.push({ name: group.name, cells: group.emoji.map((row) => ({ emoji: withSkinTone(row, tone), label: row[1] })) });
    for (const section of sections) {
      groupIndex.set(section.name, items.length);
      push({ key: `h-${section.name}`, kind: "header", title: section.name === "Recent" ? "Recently used" : section.name, group: section.name });
      for (let start = 0; start < section.cells.length; start += columns) {
        push({ key: `${section.name}-${start}`, kind: "row", cells: section.cells.slice(start, start + columns), group: section.name });
      }
    }
    return { items, offsets, groupIndex };
    // Recent emoji reorder as you pick; the list follows only when the panel opens or the tone changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, cell, tone, recent.length > 0]);

  const results = useMemo(() => (query.trim() ? searchEmoji(query) : []), [query]);
  const viewable = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems.find((token) => token.isViewable)?.item as EmojiListItem | undefined;
    if (first) setActiveGroup(first.group);
  }).current;

  const emojiCell = (emoji: string, label: string, key: string) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onPick(emoji)}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.emojiCell, { width: cell, height: cell }, hovered && styles.cellHover, pressed && styles.cellPressed]}
    >
      <Text style={[styles.emoji, { fontSize: Math.min(30, cell * 0.64), lineHeight: cell * 0.86 }]}>{emoji}</Text>
    </Pressable>
  );

  return (
    <View style={styles.flex} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      <SearchField value={query} onChange={setQuery} placeholder="Search emoji">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skin tone"
          accessibilityState={{ expanded: choosingTone }}
          onPress={() => setChoosingTone((value) => !value)}
          style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.toneButton, (hovered || choosingTone) && styles.cellHover]}
        >
          <Text style={styles.toneSwatch}>{skinToneSwatches[tone]}</Text>
        </Pressable>
      </SearchField>
      {choosingTone ? (
        <View accessibilityRole="radiogroup" style={styles.toneRow}>
          {skinToneSwatches.map((swatch, index) => (
            <Pressable
              key={swatch}
              accessibilityRole="radio"
              accessibilityLabel={["Default", "Light", "Medium-light", "Medium", "Medium-dark", "Dark"][index] + " skin tone"}
              accessibilityState={{ checked: index === tone }}
              onPress={() => { onSkinTone(index as SkinTone); setChoosingTone(false); }}
              style={[styles.toneOption, index === tone && styles.toneOptionActive]}
            >
              <Text style={styles.toneSwatch}>{swatch}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {!width ? null : query.trim() ? (
        results.length ? (
          <ScrollView contentContainerStyle={styles.wrapGrid} keyboardShouldPersistTaps="handled">
            {results.map((row: EmojiRow) => emojiCell(withSkinTone(row, tone), row[1], row[0]))}
          </ScrollView>
        ) : (
          <Empty icon="search" text={`No emoji for “${query.trim()}”`} />
        )
      ) : (
        <>
          <FlatList
            ref={list}
            data={items}
            keyExtractor={(item) => item.key}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={14}
            maxToRenderPerBatch={12}
            windowSize={7}
            getItemLayout={(_, index) => ({ length: items[index]?.kind === "header" ? headerHeight : cell, offset: offsets[index] ?? 0, index })}
            onViewableItemsChanged={viewable}
            contentContainerStyle={styles.emojiList}
            renderItem={({ item }) =>
              item.kind === "header" ? (
                <Text accessibilityRole="header" style={styles.sectionTitle}>{item.title}</Text>
              ) : (
                <View style={styles.emojiRow}>{item.cells.map((entry, index) => emojiCell(entry.emoji, entry.label, `${item.key}-${index}`))}</View>
              )
            }
          />
          <View style={styles.categoryBar}>
            {[...groupIndex.keys()].map((group) => {
              const active = group === activeGroup;
              return (
                <Pressable
                  key={group}
                  accessibilityRole="button"
                  accessibilityLabel={group}
                  accessibilityState={{ selected: active }}
                  onPress={() => { setActiveGroup(group); list.current?.scrollToIndex({ index: groupIndex.get(group) ?? 0, animated: false }); }}
                  style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.categoryButton, active && styles.categoryActive, !active && hovered && styles.cellHover]}
                >
                  <Ionicons name={groupIcons[group] ?? "ellipse-outline"} size={17} color={active ? colors.text : colors.textTertiary} />
                </Pressable>
              );
            })}
          </View>
        </>
      )}
    </View>
  );
}

// ── GIFs and animated stickers (GIPHY) ───────────────────────────────────────────────────────

function GifTab({ kind, compact, onPick, query: fixedQuery, header }: { kind: "gifs" | "stickers"; compact: boolean; onPick: (url: string) => void; query?: string; header?: React.ReactNode }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const [ownQuery, setOwnQuery] = useState("");
  const query = fixedQuery ?? ownQuery;
  const [gifs, setGifs] = useState<GifResult[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable" | "failed">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [width, setWidth] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setState("loading");
    done.current = false;
    // Wait for a pause in typing before searching.
    const timer = setTimeout(() => {
      searchGifs(query, kind, 0, controller.signal).then(
        (found) => { setGifs(found); setState("ready"); done.current = found.length < 20; },
        (reason) => { if (!controller.signal.aborted) setState(reason instanceof GifsUnavailable ? "unavailable" : "failed"); },
      );
    }, query ? 350 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, kind]);

  const more = () => {
    if (loadingMore || done.current || state !== "ready") return;
    setLoadingMore(true);
    searchGifs(query, kind, gifs.length).then(
      (found) => { setGifs((current) => [...current, ...found.filter((gif) => !current.some((other) => other.id === gif.id))]); done.current = found.length < 20; },
      () => { done.current = true; },
    ).finally(() => setLoadingMore(false));
  };

  // A masonry of columns: each GIF goes under the shortest one, at its own shape.
  const columnCount = kind === "stickers" ? (compact ? 4 : 5) : compact ? 2 : 3;
  const gap = 6;
  const columnWidth = width ? (width - 12 - gap * (columnCount - 1)) / columnCount : 0;
  const columns = useMemo(() => {
    const result: Array<{ gifs: GifResult[]; height: number }> = Array.from({ length: columnCount }, () => ({ gifs: [], height: 0 }));
    for (const gif of gifs) {
      const shortest = result.reduce((low, column) => (column.height < low.height ? column : low), result[0]);
      shortest.gifs.push(gif);
      shortest.height += kind === "stickers" ? 1 : gif.height / gif.width;
    }
    return result;
  }, [gifs, columnCount, kind]);

  return (
    <View style={styles.flex} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      {fixedQuery === undefined ? <SearchField value={ownQuery} onChange={setOwnQuery} placeholder={kind === "stickers" ? "Search animated stickers" : "Search GIFs"} /> : null}
      {header}
      {kind === "gifs" && !ownQuery && state !== "unavailable" ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ideasBar} contentContainerStyle={styles.ideas} keyboardShouldPersistTaps="handled">
          {gifIdeas.map((idea) => (
            <Pressable key={idea} accessibilityRole="button" onPress={() => setOwnQuery(idea)} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.idea, hovered && styles.ideaHover]}>
              <Text style={styles.ideaText}>{idea}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      {state === "loading" ? (
        <View style={styles.center}><Loader size="small" color={colors.textTertiary} /></View>
      ) : state === "unavailable" ? (
        <Empty icon="images-outline" text={kind === "stickers" ? "Animated stickers aren’t set up on this server yet." : "GIFs aren’t set up on this server yet."} />
      ) : state === "failed" ? (
        <Empty icon="cloud-offline-outline" text={kind === "stickers" ? "Stickers couldn’t load. Check your connection." : "GIFs couldn’t load. Check your connection."} />
      ) : !gifs.length ? (
        <Empty icon="search" text={`Nothing for “${query}”`} />
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          scrollEventThrottle={120}
          onScroll={({ nativeEvent }) => {
            if (nativeEvent.contentOffset.y + nativeEvent.layoutMeasurement.height > nativeEvent.contentSize.height - 320) more();
          }}
          contentContainerStyle={styles.masonryContent}
        >
          <View style={[styles.masonry, { gap }]}>
            {columns.map((column, index) => (
              <View key={index} style={{ width: columnWidth, gap }}>
                {column.gifs.map((gif) => (
                  <Pressable
                    key={gif.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Send ${kind === "stickers" ? "sticker" : "GIF"}${gif.title ? `: ${gif.title}` : ""}`}
                    onPress={() => onPick(gifURL(gif, kind === "stickers" ? "sticker" : "gif"))}
                    style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                      kind === "stickers" ? styles.stickerTile : styles.gifTile,
                      { width: columnWidth, height: kind === "stickers" ? columnWidth : columnWidth * (gif.height / gif.width) },
                      hovered && (kind === "stickers" ? styles.cellHover : styles.gifHover),
                      pressed && styles.cellPressed,
                    ]}
                  >
                    <Image source={{ uri: gifPreviewURL(gif.id) }} resizeMode={kind === "stickers" ? "contain" : "cover"} style={styles.fill} />
                  </Pressable>
                ))}
              </View>
            ))}
          </View>
          {loadingMore ? <View style={styles.moreLoader}><Loader size="small" color={colors.textTertiary} /></View> : null}
        </ScrollView>
      )}
      {state !== "unavailable" ? <Text style={styles.credit}>Powered by GIPHY</Text> : null}
    </View>
  );
}

// ── Stickers (Fluent Emoji 3D, and GIPHY's animated ones) ────────────────────────────────────

const animatedPack = "Animated";

function StickerTab({ compact, onPick }: { compact: boolean; onPick: (url: string) => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const [pack, setPack] = useState(stickerCategories[0]?.name ?? "Smileys");
  const [query, setQuery] = useState("");
  const [width, setWidth] = useState(0);
  const columns = compact ? 5 : 7;
  const size = width ? (width - 12) / columns : 0;
  const animated = pack === animatedPack;
  const shown: StickerRow[] = useMemo(
    () => (animated ? [] : query.trim() ? searchStickers(query) : stickerCategories.find((category) => category.name === pack)?.stickers ?? []),
    [animated, pack, query],
  );
  const rows = useMemo(() => {
    const result: StickerRow[][] = [];
    for (let start = 0; start < shown.length; start += columns) result.push(shown.slice(start, start + columns));
    return result;
  }, [shown, columns]);

  const packs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ideasBar} contentContainerStyle={styles.ideas} keyboardShouldPersistTaps="handled">
      {[animatedPack, ...stickerCategories.map((category) => category.name)].map((name) => {
        const active = name === pack && (!query.trim() || name === animatedPack);
        return (
          <Pressable key={name} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => { setPack(name); if (name !== animatedPack) setQuery(""); }} style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.idea, active && styles.ideaActive, !active && hovered && styles.ideaHover]}>
            {name === animatedPack ? <Ionicons name="sparkles" size={12} color={active ? colors.surface : colors.textSecondary} /> : null}
            <Text style={[styles.ideaText, active && styles.ideaTextActive]}>{name}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={styles.flex} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      <SearchField value={query} onChange={setQuery} placeholder={animated ? "Search animated stickers" : "Search stickers"} />
      {animated ? (
        <GifTab kind="stickers" compact={compact} onPick={onPick} query={query} header={packs} />
      ) : (
        <>
          {packs}
          {!size ? null : rows.length ? (
            <FlatList
              data={rows}
              keyExtractor={(row) => row[0][0]}
              keyboardShouldPersistTaps="handled"
              initialNumToRender={5}
              windowSize={5}
              getItemLayout={(_, index) => ({ length: size, offset: size * index, index })}
              contentContainerStyle={styles.emojiList}
              renderItem={({ item }) => (
                <View style={styles.emojiRow}>
                  {item.map((sticker) => (
                    <Pressable
                      key={sticker[0]}
                      accessibilityRole="button"
                      accessibilityLabel={`Send sticker: ${sticker[1].split(" ").slice(0, 4).join(" ")}`}
                      onPress={() => onPick(stickerURL(sticker[0]))}
                      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.stickerCell, { width: size, height: size }, hovered && styles.cellHover, pressed && styles.cellPressed]}
                    >
                      <Image source={{ uri: stickerURL(sticker[0]) }} resizeMode="contain" style={styles.stickerImage} />
                    </Pressable>
                  ))}
                </View>
              )}
            />
          ) : (
            <Empty icon="search" text={`No stickers for “${query.trim()}”`} />
          )}
          <Text style={styles.credit}>Fluent Emoji by Microsoft</Text>
        </>
      )}
    </View>
  );
}

// ── Me: avatar stickers (DiceBear Avataaars) ─────────────────────────────────────────────────

function AvatarTab({ seed, onSeed, onPick }: { seed?: string; onSeed: (seed: string) => void; onPick: (url: string) => void }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  const [width, setWidth] = useState(0);
  // Other looks to choose from; your current one stays first.
  const [looks, setLooks] = useState<string[]>(() => Array.from({ length: 5 }, () => newAvatarSeed()));
  if (!seed) return <View style={styles.center}><Loader size="small" color={colors.textTertiary} /></View>;
  const columns = width >= 520 ? 6 : 4;
  const tile = width ? (width - 12 - 8 * (columns - 1)) / columns : 0;
  const choices = [seed, ...looks.filter((look) => look !== seed)].slice(0, 6);
  return (
    <View style={styles.flex} onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      <View style={styles.lookRow}>
        <Text style={styles.lookTitle}>Your look</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.looks}>
          {choices.map((look) => (
            <Pressable
              key={look}
              accessibilityRole="radio"
              accessibilityLabel={look === seed ? "Your current look" : "Another look"}
              accessibilityState={{ checked: look === seed }}
              onPress={() => onSeed(look)}
              style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.look, look === seed && styles.lookActive, look !== seed && hovered && styles.cellHover]}
            >
              <AvatarImage uri={avatarStickerURL(look)} size={36} />
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Show other looks"
            onPress={() => setLooks(Array.from({ length: 5 }, () => newAvatarSeed()))}
            style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [styles.look, styles.shuffle, hovered && styles.cellHover]}
          >
            <Ionicons name="shuffle" size={18} color={colors.textSecondary} />
          </Pressable>
        </ScrollView>
      </View>
      {tile ? (
        <ScrollView contentContainerStyle={[styles.avatarGrid, { gap: 8 }]} keyboardShouldPersistTaps="handled">
          {avatarExpressions.map((expression) => (
            <Pressable
              key={expression.id}
              accessibilityRole="button"
              accessibilityLabel={`Send avatar sticker: ${expression.label}`}
              onPress={() => onPick(avatarStickerURL(seed, expression))}
              style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [styles.avatarTile, { width: tile }, hovered && styles.avatarTileHover, pressed && styles.cellPressed]}
            >
              <AvatarImage uri={avatarStickerURL(seed, expression)} size={tile - 16} />
              <Text numberOfLines={1} style={styles.avatarLabel}>{expression.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
      <Text style={styles.credit}>Avataaars by Pablo Stanley · DiceBear</Text>
    </View>
  );
}

/**
 * DiceBear allows about ten PNGs a second per visitor, so avatar images start one at a time,
 * eight a second, and try again if one is turned away. Ones already seen show at once.
 */
const avatarLoaded = new Set<string>();
let avatarNextSlot = 0;
function avatarDelay(uri: string): number {
  if (avatarLoaded.has(uri)) return 0;
  const now = Date.now();
  avatarNextSlot = Math.max(avatarNextSlot, now) + 125;
  return avatarNextSlot - 125 - now;
}

function AvatarImage({ uri, size }: { uri: string; size: number }) {
  const { colors } = useOpenMediaTheme();
  const [attempt, setAttempt] = useState(0);
  const [start, setStart] = useState(() => avatarLoaded.has(uri));
  const [loaded, setLoaded] = useState(() => avatarLoaded.has(uri));
  useEffect(() => {
    if (start) return;
    const timer = setTimeout(() => setStart(true), avatarDelay(uri));
    return () => clearTimeout(timer);
  }, [uri, start]);
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: loaded ? "transparent" : colors.chrome }}>
      {start ? (
        <Image
          key={attempt}
          source={{ uri }}
          onLoad={() => { avatarLoaded.add(uri); setLoaded(true); }}
          onError={() => { if (attempt < 3) setTimeout(() => setAttempt((value) => value + 1), avatarDelay(uri) + 900); }}
          style={{ width: size, height: size }}
        />
      ) : null}
    </View>
  );
}

function Empty({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const { colors } = useOpenMediaTheme();
  const styles = useThemedStyles(createStyles);
  return (
    <View style={styles.center}>
      <View style={styles.emptyIcon}><Ionicons name={icon} size={20} color={colors.textTertiary} /></View>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    panel: {
      marginBottom: 8,
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      overflow: "hidden",
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: 8 },
      elevation: 4,
    },
    tabs: {
      flexDirection: "row",
      margin: 8,
      marginBottom: 0,
      padding: 3,
      borderRadius: 14,
      backgroundColor: colors.chrome,
    },
    tab: { flex: 1, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 11 },
    tabHover: { backgroundColor: colors.border },
    tabActive: {
      backgroundColor: colors.surface,
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 1 },
      elevation: 1,
    },
    tabText: { color: colors.textTertiary, fontSize: 13, fontWeight: "600" },
    tabTextActive: { color: colors.text },
    body: { flex: 1 },
    flex: { flex: 1 },
    fill: { width: "100%", height: "100%" },
    searchRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingTop: 8, paddingBottom: 4 },
    search: {
      flex: 1,
      height: 36,
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      paddingHorizontal: 11,
      borderRadius: 12,
      backgroundColor: colors.chrome,
    },
    searchInput: { flex: 1, paddingVertical: 0, color: colors.text, fontSize: 14, outlineStyle: "none" } as object,
    toneButton: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
    toneSwatch: { fontSize: 20, lineHeight: 26 },
    toneRow: {
      flexDirection: "row",
      alignSelf: "flex-end",
      gap: 2,
      marginRight: 8,
      marginBottom: 4,
      padding: 3,
      borderRadius: 14,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    toneOption: { width: 36, height: 36, borderRadius: 11, alignItems: "center", justifyContent: "center" },
    toneOptionActive: { backgroundColor: colors.chrome },
    emojiList: { paddingHorizontal: 6, paddingBottom: 8 },
    emojiRow: { flexDirection: "row" },
    sectionTitle: {
      height: headerHeight,
      paddingTop: 10,
      paddingHorizontal: 6,
      color: colors.textTertiary,
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    emojiCell: { alignItems: "center", justifyContent: "center", borderRadius: 10 },
    emoji: { textAlign: "center" },
    cellHover: { backgroundColor: colors.chrome },
    cellPressed: { transform: [{ scale: 0.9 }] },
    wrapGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 6, paddingBottom: 8 },
    categoryBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      paddingHorizontal: 6,
      paddingVertical: 4,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    categoryButton: { flex: 1, maxWidth: 44, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 10 },
    categoryActive: { backgroundColor: colors.chrome },
    ideasBar: { flexGrow: 0, flexShrink: 0 },
    ideas: { gap: 6, paddingHorizontal: 8, paddingTop: 2, paddingBottom: 8 },
    idea: {
      height: 28,
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 11,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    ideaHover: { backgroundColor: colors.chrome },
    ideaActive: { backgroundColor: colors.text, borderColor: colors.text },
    ideaText: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
    ideaTextActive: { color: colors.surface },
    masonryContent: { paddingHorizontal: 6, paddingBottom: 10 },
    masonry: { flexDirection: "row" },
    gifTile: { borderRadius: 12, overflow: "hidden", backgroundColor: colors.chrome },
    gifHover: { opacity: 0.86 },
    stickerTile: { borderRadius: 12, padding: 4 },
    stickerCell: { alignItems: "center", justifyContent: "center", borderRadius: 14, padding: 7 },
    stickerImage: { width: "100%", height: "100%" },
    moreLoader: { paddingVertical: 14, alignItems: "center" },
    center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
    emptyIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.chrome },
    emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: "center", maxWidth: 260, lineHeight: 19 },
    credit: { paddingVertical: 5, textAlign: "center", color: colors.textTertiary, fontSize: 10, fontWeight: "600", letterSpacing: 0.4 },
    lookRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 14, paddingTop: 10, paddingBottom: 6 },
    lookTitle: { color: colors.textTertiary, fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" },
    looks: { gap: 6, paddingRight: 10, alignItems: "center" },
    look: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "transparent" },
    lookActive: { borderColor: colors.text, backgroundColor: colors.surface },
    shuffle: { backgroundColor: colors.chrome },
    avatarGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 6, paddingBottom: 10 },
    avatarTile: {
      alignItems: "center",
      paddingTop: 8,
      paddingBottom: 6,
      borderRadius: 16,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    avatarTileHover: { backgroundColor: colors.chrome },
    avatarLabel: { marginTop: 2, color: colors.textSecondary, fontSize: 11, fontWeight: "600" },
  });
}
