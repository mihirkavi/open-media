/**
 * Knowledge graph extractor (code layer). Uses the TypeScript compiler's type checker
 * to emit compiler-accurate symbols and edges as JSON lines on stdout:
 *   {"t":"file", ...} {"t":"sym", ...} {"t":"edge", ...} {"t":"test", ...} {"t":"route", ...}
 * build.py consumes this, adds SQL migrations and Markdown docs, and writes SQLite.
 * Zero LLM tokens: everything here is static analysis.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(process.argv[2] ?? '.');
// Tracked plus untracked-but-not-ignored files, so new work is indexed before it is committed.
const tracked = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 })
  .split('\0')
  .filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith('.d.ts') && !f.includes('node_modules/') && existsSync(path.join(root, f)));
const trackedSet = new Set(tracked);

const program = ts.createProgram(
  tracked.map((f) => path.join(root, f)),
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    allowJs: false,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
    noResolve: false,
    types: [],
  },
);
const checker = program.getTypeChecker();

const out: string[] = [];
const emit = (o: object) => out.push(JSON.stringify(o));
const rel = (abs: string) => path.relative(root, abs).split(path.sep).join('/');
const line = (sf: ts.SourceFile, pos: number) => sf.getLineAndCharacterOfPosition(pos).line + 1;
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Declaration node -> symbol id, for every symbol we index. */
const declId = new Map<ts.Node, string>();

function docOf(node: ts.Node): string {
  const tags = ts.getJSDocCommentsAndTags(node);
  for (const tag of tags) {
    if (ts.isJSDoc(tag) && tag.comment) {
      const text = typeof tag.comment === 'string' ? tag.comment : tag.comment.map((c) => c.text).join('');
      return clip(oneLine(text.split(/\n\s*\n/)[0]), 320);
    }
  }
  return '';
}

function signatureOf(sf: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sf);
  // Cut at the body: first "{" that opens a block after the parameter list, or "=>".
  let cut = text.length;
  const arrow = text.indexOf('=>');
  if (arrow >= 0) cut = Math.min(cut, arrow + 2);
  // const X = memo(function X(...) { ... }) / forwardRef(...) / function expressions: stop at the body.
  if (ts.isVariableDeclaration(node) && node.initializer) {
    const fnBody = (n: ts.Node): ts.Node | undefined =>
      (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) ? n.body : ts.isCallExpression(n) ? n.arguments.map(fnBody).find(Boolean) : undefined;
    const body = fnBody(node.initializer);
    if (body && ts.isBlock(body)) cut = Math.min(cut, body.getStart(sf) - node.getStart(sf));
    else if (!body) cut = Math.min(cut, 160);
  }
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isEnumDeclaration(node)) {
    const body = (node as ts.FunctionDeclaration).body ?? undefined;
    if (body) cut = Math.min(cut, body.getStart(sf) - node.getStart(sf));
    else if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node)) {
      const brace = text.indexOf('{');
      if (brace >= 0) cut = Math.min(cut, brace);
    }
  }
  return clip(oneLine(text.slice(0, cut)), 240);
}

function isExported(node: ts.Node): boolean {
  const mods = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
  return !!mods?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function returnsJsx(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxFragment(n)) found = true;
    else ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

function addSym(sf: ts.SourceFile, file: string, node: ts.Node, name: string, kind: string, exported: boolean, docNode: ts.Node = node) {
  const id = `${file}#${name}`;
  declId.set(node, id);
  const start = line(sf, node.getStart(sf));
  const end = line(sf, node.getEnd());
  emit({ t: 'sym', id, file, name, kind, exported, start, end, sig: signatureOf(sf, node), doc: docOf(docNode) });
  return id;
}

function fileDoc(sf: ts.SourceFile): string {
  const first = sf.statements[0];
  const ranges = ts.getLeadingCommentRanges(sf.text, first ? first.getFullStart() : 0) ?? [];
  for (const r of ranges) {
    const raw = sf.text.slice(r.pos, r.end);
    const text = raw.replace(/^\/\*\*?|\*\/$/g, '').replace(/^\s*\*\s?/gm, '').replace(/^\s*\/\/\s?/gm, '');
    const para = oneLine(text.split(/\n\s*\n/)[0]);
    if (para.length > 20 && !/eslint|@ts-|prettier/.test(para)) return clip(para, 320);
  }
  return '';
}

// Pass 1: declarations.
for (const sf of program.getSourceFiles()) {
  const file = rel(sf.fileName);
  if (!trackedSet.has(file)) continue;
  const isTest = /\.test\.tsx?$/.test(file);
  emit({ t: 'file', path: file, lines: sf.getLineAndCharacterOfPosition(sf.getEnd()).line + 1, doc: fileDoc(sf), test: isTest });

  for (const st of sf.statements) {
    const exported = isExported(st);
    if (ts.isFunctionDeclaration(st) && st.name) {
      const comp = file.endsWith('.tsx') && /^[A-Z]/.test(st.name.text) && returnsJsx(st);
      addSym(sf, file, st, st.name.text, comp ? 'component' : 'function', exported);
    } else if (ts.isClassDeclaration(st) && st.name) {
      addSym(sf, file, st, st.name.text, 'class', exported);
      for (const m of st.members) {
        if ((ts.isMethodDeclaration(m) || ts.isPropertyDeclaration(m) || ts.isGetAccessor(m)) && m.name && ts.isIdentifier(m.name)) {
          const isFn = ts.isMethodDeclaration(m) || ts.isGetAccessor(m) || (ts.isPropertyDeclaration(m) && !!m.initializer && (ts.isArrowFunction(m.initializer) || ts.isFunctionExpression(m.initializer)));
          if (isFn) addSym(sf, file, m, `${st.name.text}.${m.name.text}`, 'method', exported);
        }
      }
    } else if (ts.isInterfaceDeclaration(st)) addSym(sf, file, st, st.name.text, 'interface', exported);
    else if (ts.isTypeAliasDeclaration(st)) addSym(sf, file, st, st.name.text, 'type', exported);
    else if (ts.isEnumDeclaration(st)) addSym(sf, file, st, st.name.text, 'enum', exported);
    else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name)) continue;
        let init = d.initializer;
        while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression(init) || ts.isParenthesizedExpression(init))) init = init.expression;
        // memo(...), forwardRef(...), lazyComponent(...) wrappers.
        let wrapped = init;
        if (wrapped && ts.isCallExpression(wrapped) && wrapped.arguments[0] && (ts.isArrowFunction(wrapped.arguments[0]) || ts.isFunctionExpression(wrapped.arguments[0]))) wrapped = wrapped.arguments[0];
        const isFn = !!wrapped && (ts.isArrowFunction(wrapped) || ts.isFunctionExpression(wrapped));
        const name = d.name.text;
        const comp = /^[A-Z]/.test(name) && file.endsWith('.tsx') && !!init && returnsJsx(init);
        const kind = comp ? 'component' : isFn ? 'function' : 'const';
        const id = addSym(sf, file, d, name, kind, exported, st);
        declId.set(st, id);
      }
    }
  }
}

// Map a TS symbol to our symbol id (follows import aliases).
function resolve(sym: ts.Symbol | undefined): string | undefined {
  if (!sym) return undefined;
  if (sym.flags & ts.SymbolFlags.Alias) {
    try { sym = checker.getAliasedSymbol(sym); } catch { return undefined; }
  }
  for (const d of sym.declarations ?? []) {
    const id = declId.get(d);
    if (id) return id;
  }
  return undefined;
}

function enclosing(node: ts.Node): string | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const id = declId.get(n);
    if (id) return id;
  }
  return undefined;
}

const edgeSeen = new Set<string>();
function edge(src: string, dst: string, rel: string, extra?: Record<string, unknown>) {
  if (src === dst) return;
  const key = `${src}\0${dst}\0${rel}`;
  if (edgeSeen.has(key)) return;
  edgeSeen.add(key);
  emit({ t: 'edge', src, dst, rel, ...extra });
}

const ROUTE = /^\/(?:[\w.-]+)(?:\/[\w.:{}-]*)*$/;

// Pass 2: edges.
for (const sf of program.getSourceFiles()) {
  const file = rel(sf.fileName);
  if (!trackedSet.has(file)) continue;
  const isTest = /\.test\.tsx?$/.test(file);

  for (const st of sf.statements) {
    if ((ts.isImportDeclaration(st) || ts.isExportDeclaration(st)) && st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier)) {
      const spec = st.moduleSpecifier.text;
      const resolved = ts.resolveModuleName(spec, sf.fileName, program.getCompilerOptions(), ts.sys).resolvedModule;
      const target = resolved ? rel(resolved.resolvedFileName) : undefined;
      if (target && trackedSet.has(target)) {
        edge(file, target, isTest ? 'TESTS' : 'IMPORTS');
        if (isTest) edge(file, target, 'IMPORTS');
      } else if (!spec.startsWith('.')) {
        edge(file, `pkg:${spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0]}`, 'USES_PACKAGE');
      }
    }
  }

  const visit = (n: ts.Node) => {
    // Calls and `new`.
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) {
      const callee = n.expression;
      const target = resolve(checker.getSymbolAtLocation(ts.isPropertyAccessExpression(callee) ? callee.name : callee));
      const from = enclosing(n) ?? file;
      if (target) edge(from, target, 'CALLS');

      // Test cases: test('name', ...), it(...), describe(...).
      if (isTest && ts.isCallExpression(n) && ts.isIdentifier(callee) && /^(test|it|describe)$/.test(callee.text) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        emit({ t: 'test', file, name: clip(n.arguments[0].text, 200), line: line(sf, n.getStart(sf)) });
      }
      // Database access: .from('table') / .rpc('fn') / rest/v1/<table> strings.
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(callee) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) {
        const m = callee.name.text;
        if (m === 'from') edge(from, `table:${n.arguments[0].text}`, 'USES_TABLE');
        if (m === 'rpc') edge(from, `sqlfn:${n.arguments[0].text}`, 'CALLS_RPC');
      }
    }
    if (ts.isStringLiteralLike(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const text = n.text;
      for (const m of text.matchAll(/rest\/v1\/(rpc\/)?([a-z_][a-z0-9_]*)/g)) {
        edge(enclosing(n) ?? file, m[1] ? `sqlfn:${m[2]}` : `table:${m[2]}`, m[1] ? 'CALLS_RPC' : 'USES_TABLE');
      }
    }
    // Routes: <x>.pathname === '/foo', pathname.startsWith('/foo'), path === '/foo'.
    if (ts.isBinaryExpression(n) && (n.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken)) {
      const [a, b] = [n.left, n.right];
      const lit = ts.isStringLiteralLike(b) ? b : ts.isStringLiteralLike(a) ? a : undefined;
      const other = lit === b ? a : b;
      const otherText = other.getText(sf);
      if (lit && ROUTE.test(lit.text) && /path(name)?\b|route\b/i.test(otherText)) {
        const owner = enclosing(n) ?? file;
        emit({ t: 'route', path: lit.text, owner, line: line(sf, n.getStart(sf)) });
      }
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'startsWith' && /path(name)?\b/i.test(n.expression.expression.getText(sf)) && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0]) && ROUTE.test(n.arguments[0].text)) {
      emit({ t: 'route', path: `${n.arguments[0].text}*`, owner: enclosing(n) ?? file, line: line(sf, n.getStart(sf)) });
    }
    // JSX renders.
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const target = resolve(checker.getSymbolAtLocation(n.tagName));
      if (target) edge(enclosing(n) ?? file, target, 'RENDERS');
    }
    // Heritage.
    if (ts.isHeritageClause(n)) {
      const owner = enclosing(n);
      for (const t of n.types) {
        const target = resolve(checker.getSymbolAtLocation(t.expression));
        if (owner && target) edge(owner, target, n.token === ts.SyntaxKind.ExtendsKeyword ? 'EXTENDS' : 'IMPLEMENTS');
      }
    }
    // Type references (interface/type usage), only from top-level declarations to project types.
    if (ts.isTypeReferenceNode(n)) {
      const target = resolve(checker.getSymbolAtLocation(n.typeName));
      const owner = enclosing(n);
      if (owner && target) edge(owner, target, 'USES_TYPE');
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

process.stdout.write(`${out.join('\n')}\n`);
