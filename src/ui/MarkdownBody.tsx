import { Fragment, useMemo } from 'react';
import { Linking, Platform, ScrollView, StyleProp, StyleSheet, TextStyle, View } from 'react-native';

import { collapsedTableRows, inlineText, isNumericCell, MdBlock, MdInline } from '../domain/markdown';
import { ThemeColors } from '../theme';
import { useOpenMediaTheme } from '../themeContext';
import { RichText } from './RichText';
import { Text } from './Text';

const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' });

/** Rows an expanded table shows before pointing to the original post for the rest. */
const expandedTableRows = 30;

/**
 * A post's own formatting (Hive and Lens write Markdown), drawn in Open Media's type: the body
 * style for paragraphs, a quiet scale for headings, a thin rule for quotes, and tables with a
 * light header and right-aligned figures that scroll sideways when they are wide. Mentions,
 * hashtags, bare links and search matches inside it behave as they do in any post.
 */
export function MarkdownBody({ blocks, source, style, collapsed }: { blocks: MdBlock[]; source: string; style?: StyleProp<TextStyle>; collapsed: boolean }) {
  const { colors } = useOpenMediaTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const base = StyleSheet.flatten(style) ?? {};
  const inline = (content: MdInline[]) => <Inline content={content} source={source} styles={styles} />;
  return <View style={[styles.stack, { marginTop: base.marginTop ?? 10 }]}>
    {blocks.map((block, index) => {
      switch (block.kind) {
        case 'heading': return <Text key={index} accessibilityRole="header" style={[styles.heading, block.level <= 1 ? styles.h1 : block.level === 2 ? styles.h2 : styles.h3]}>{inline(block.content)}</Text>;
        case 'paragraph': return <Text key={index} selectable style={[base, styles.flush]}>{inline(block.content)}</Text>;
        case 'quote': return <View key={index} style={styles.quote}><Text selectable style={[base, styles.flush, styles.quoteText]}>{inline(block.content)}</Text></View>;
        case 'rule': return <View key={index} style={styles.rule} />;
        case 'code': return <ScrollView key={index} horizontal showsHorizontalScrollIndicator={false} style={styles.codeBlock}><Text selectable style={styles.codeText}>{block.text}</Text></ScrollView>;
        case 'list': return <View key={index} style={styles.list}>{block.items.map((item, at) => <View key={at} style={styles.listItem}>
          <Text style={[base, styles.flush, styles.marker]}>{block.ordered ? `${block.start + at}.` : '•'}</Text>
          <Text selectable style={[base, styles.flush, styles.grow]}>{inline(item)}</Text>
        </View>)}</View>;
        case 'table': {
          const limit = collapsed ? collapsedTableRows : expandedTableRows;
          const rows = block.rows.slice(0, limit);
          const numeric = block.header.map((_, column) => rows.length > 0 && rows.every((row) => !row[column] || isNumericCell(row[column])));
          // Each column is as wide as its longest value (so figures never wrap) and shares any spare
          // width evenly; every row uses the same widths, so the columns stay aligned.
          const widths = block.header.map((header, column) => {
            const longest = Math.max(0, ...rows.map((row) => row[column] ? inlineText(row[column]).length : 0));
            const word = Math.max(0, ...inlineText(header).split(/\s+/).map((part) => part.length));
            return Math.min(280, Math.max(88, longest * 7.8 + 26, word * 7.2 + 26));
          });
          const cell = (content: MdInline[] | undefined, column: number, header = false) => <View key={column} style={[styles.cell, { flexBasis: widths[column] }]}>
            <Text style={[header ? styles.headerText : styles.cellText, numeric[column] && styles.numeric, block.align[column] === 'center' && styles.center]}>{content ? inline(content) : ''}</Text>
          </View>;
          return <View key={index}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.table} contentContainerStyle={styles.tableContent}>
              <View style={styles.tableInner}>
                <View style={[styles.row, styles.headerRow]}>{block.header.map((content, column) => cell(content, column, true))}</View>
                {rows.map((row, at) => <View key={at} style={[styles.row, at > 0 && styles.rowRule]}>{block.header.map((_, column) => cell(row[column], column))}</View>)}
              </View>
            </ScrollView>
            {block.rows.length > rows.length ? <Text style={styles.more}>{block.rows.length - rows.length} more {block.rows.length - rows.length === 1 ? 'row' : 'rows'}{collapsed ? '' : ' on the original post'}</Text> : null}
          </View>;
        }
      }
    })}
  </View>;
}

function Inline({ content, source, styles }: { content: MdInline[]; source: string; styles: ReturnType<typeof createStyles> }) {
  return <>{content.map((part, index) => {
    switch (part.kind) {
      case 'text': return <RichText key={index} text={part.text} source={source} />;
      case 'strong': return <Text key={index} style={styles.strong}><Inline content={part.children} source={source} styles={styles} /></Text>;
      case 'em': return <Text key={index} style={styles.em}><Inline content={part.children} source={source} styles={styles} /></Text>;
      case 'strike': return <Text key={index} style={styles.strike}><Inline content={part.children} source={source} styles={styles} /></Text>;
      case 'code': return <Text key={index} style={styles.inlineCode}>{part.text}</Text>;
      case 'link': return <Text key={index} accessibilityRole="link" onPress={() => { Linking.openURL(part.url).catch(() => undefined); }} style={styles.link}><Inline content={part.children} source={source} styles={styles} /></Text>;
      default: return <Fragment key={index} />;
    }
  })}</>;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    stack: { gap: 10 },
    flush: { marginTop: 0 },
    grow: { flex: 1 },
    heading: { marginTop: 4, color: colors.text, fontWeight: '700', letterSpacing: -0.2 },
    h1: { fontSize: 19, lineHeight: 25 },
    h2: { fontSize: 17, lineHeight: 23 },
    h3: { fontSize: 15, lineHeight: 21 },
    strong: { color: colors.text, fontWeight: '700' },
    em: { fontStyle: 'italic' },
    strike: { textDecorationLine: 'line-through' },
    link: { color: colors.text, fontWeight: '600', textDecorationLine: 'underline', textDecorationColor: colors.textTertiary },
    inlineCode: { fontFamily: mono, fontSize: 13, color: colors.text, backgroundColor: colors.chrome },
    quote: { paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: colors.border },
    quoteText: { color: colors.textSecondary },
    rule: { height: StyleSheet.hairlineWidth, marginVertical: 2, backgroundColor: colors.border },
    codeBlock: { borderRadius: 12, backgroundColor: colors.chrome },
    codeText: { padding: 12, fontFamily: mono, fontSize: 13, lineHeight: 19, color: colors.text },
    list: { gap: 4 },
    listItem: { flexDirection: 'row', gap: 8 },
    marker: { minWidth: 16, color: colors.textTertiary, fontVariant: ['tabular-nums'] },
    table: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
    tableContent: { minWidth: '100%' },
    tableInner: { flex: 1 },
    row: { flexDirection: 'row' },
    headerRow: { backgroundColor: colors.chrome },
    rowRule: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    cell: { flexGrow: 1, flexShrink: 0, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center' },
    headerText: { color: colors.textSecondary, fontSize: 12, lineHeight: 16, fontWeight: '600' },
    cellText: { color: colors.text, fontSize: 14, lineHeight: 19 },
    numeric: { textAlign: 'right', fontVariant: ['tabular-nums'] },
    center: { textAlign: 'center' },
    more: { marginTop: 6, color: colors.textTertiary, fontSize: 12 },
  });
}
