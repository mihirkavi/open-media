#!/usr/bin/env python3
"""Query the Open Media knowledge graph with compact, token-cheap output.

  kg.py overview                 repo map: areas, central symbols, ADRs (start here)
  kg.py search <words> [-k kind] BM25 search over symbols, tests, tables, routes, doc sections
  kg.py sym <name>               signature, doc, callers, callees, types, data, tests, docs
  kg.py body <name>              source of a symbol / section (the "parent chunk")
  kg.py file <path>              outline: symbols with lines, imports, importers, tests, ADRs
  kg.py callers <name> [-d 2]    who calls/renders it (reverse tree)
  kg.py callees <name> [-d 1]    what it calls/renders
  kg.py impact <name|path>       transitive dependents grouped by file + test files to run
  kg.py path <a> <b>             shortest connection between two symbols/files/tables
  kg.py table <name>             columns, policies, FKs, migrations, SQL functions, code users
  kg.py route [prefix]           Worker routes and their handlers
  kg.py adr <number|words>       decision status, sections, code it names, code citing it
  kg.py area [n]                 architecture areas (communities) and their summary cards
  kg.py stats

The graph rebuilds automatically when tracked files changed (about 9 s); pass --no-refresh to skip.
"""
from __future__ import annotations

import collections
import re
import sqlite3
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build  # noqa: E402

ROOT = build.ROOT
CODE_RELS = ("CALLS", "RENDERS", "USES_TYPE", "EXTENDS", "IMPLEMENTS")
SYMBOL_KINDS = ("function", "component", "class", "method", "interface", "type", "enum", "const")


def clip(s: str | None, n: int) -> str:
    s = (s or "").replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


class Graph:
    def __init__(self) -> None:
        self.con = sqlite3.connect(build.DB_PATH)
        self.con.row_factory = sqlite3.Row

    def q(self, sql: str, *args):
        return self.con.execute(sql, args).fetchall()

    def node(self, nid: str):
        r = self.q("select * from nodes where id=?", nid)
        return r[0] if r else None

    def loc(self, n) -> str:
        if not n["file"]:
            return ""
        return f"{n['file']}:{n['start']}" if n["start"] and n["kind"] not in ("file", "test-file") else n["file"]

    def label(self, n) -> str:
        return f"{n['kind']} {n['name']}  {self.loc(n)}"

    # ---- resolution -------------------------------------------------------
    def resolve(self, q: str, kinds: tuple[str, ...] | None = None):
        q = q.strip()
        kind_sql = f" and kind in ({','.join('?' * len(kinds))})" if kinds else ""
        kargs = kinds or ()
        if n := self.node(q):
            return n, []
        if re.fullmatch(r"(adr[: ]?)?0*\d{1,4}", q, re.I):
            num = int(re.sub(r"\D", "", q))
            if n := self.node(f"adr:{num:04d}"):
                return n, []
        for prefix in ("table:", "sqlfn:", "route:", "pkg:"):
            if n := self.node(prefix + q):
                if not kinds or n["kind"] in kinds:
                    return n, []
        if "/" in q or re.search(r"\.(tsx?|sql|md)$", q):
            rows = self.q("select * from nodes where kind in ('file','test-file','migration','doc') and (id=? or id like ?) order by length(id)", q, f"%{q}")
            if rows:
                return rows[0], rows[1:5]
        stem = self.q("select * from nodes where kind in ('file','test-file') and (name like ? or name like ?) order by length(id)", f"{q}.ts", f"{q}.tsx")
        if stem and not kinds:
            return stem[0], stem[1:5]
        for coll in ("", " collate nocase"):
            rows = self.q(f"select * from nodes where name=?{coll}{kind_sql} and kind not in ('section','test') order by exported desc, rank desc", q, *kargs)
            if rows:
                return rows[0], rows[1:5]
        hits = self.search(q, limit=5, kinds=kinds)
        if hits:
            return hits[0], hits[1:5]
        return None, []

    def must(self, q: str, kinds=None):
        n, alts = self.resolve(q, kinds)
        if not n:
            sys.exit(f"no match for {q!r}. Try: kg.py search {q}")
        if alts:
            print("# also: " + "; ".join(f"{a['name']} {self.loc(a)}" for a in alts))
        return n

    # ---- search -----------------------------------------------------------
    def search(self, text: str, limit: int = 12, kinds=None):
        words = [w for w in re.findall(r"[A-Za-z0-9]+", build.split_words(text)) if len(w) > 1]
        if not words:
            return []
        match = " OR ".join(f'"{w}"*' for w in words)
        kind_sql = f" and n.kind in ({','.join('?' * len(kinds))})" if kinds else ""
        rows = self.q(
            f"""select n.*, bm25(fts, 0, 10.0, 6.0, 3.0, 1.0, 2.0) as score from fts join nodes n on n.id = fts.id
                where fts match ? {kind_sql} order by score limit ?""",
            match, *(kinds or ()), limit * 4,
        )
        exact = {w.lower() for w in re.findall(r"\w+", text)}

        def adjusted(r):
            bonus = 1.0 + min(r["rank"] * 2000, 1.5)
            if r["name"].lower() in exact or r["name"].lower() == text.lower():
                bonus += 2.0
            if r["kind"] == "test":
                bonus *= 0.6
            return r["score"] * bonus

        return sorted(rows, key=adjusted)[:limit]

    # ---- edges ------------------------------------------------------------
    def out(self, nid: str, rels):
        return self.q(f"select e.rel, n.* from edges e join nodes n on n.id=e.dst where e.src=? and e.rel in ({','.join('?' * len(rels))}) order by n.rank desc", nid, *rels)

    def inc(self, nid: str, rels):
        return self.q(f"select e.rel, n.* from edges e join nodes n on n.id=e.src where e.dst=? and e.rel in ({','.join('?' * len(rels))}) order by n.rank desc", nid, *rels)

    def tests_for_file(self, f: str):
        return [r["id"] for r in self.inc(f, ("TESTS",))]


# ---------------------------------------------------------------- commands

def listing(g: Graph, title: str, rows, limit: int, fmt=None) -> None:
    if not rows:
        return
    fmt = fmt or (lambda r: f"{r['name']}  {g.loc(r)}")
    lines = list(dict.fromkeys(x for x in map(fmt, rows) if x))
    if not lines:
        return
    print(f"{title} ({len(lines)}):")
    for line in lines[:limit]:
        print(f"  - {line}")
    if len(lines) > limit:
        print(f"  … {len(lines) - limit} more")


def cmd_overview(g: Graph, args) -> None:
    print((build.OUT_DIR / "OVERVIEW.md").read_text().rstrip())


def cmd_search(g: Graph, args) -> None:
    kinds = None
    if "-k" in args:
        i = args.index("-k")
        kinds = tuple(args[i + 1].split(","))
        args = args[:i] + args[i + 2 :]
    limit = 12
    if "-n" in args:
        i = args.index("-n")
        limit = int(args[i + 1])
        args = args[:i] + args[i + 2 :]
    for r in g.search(" ".join(args), limit=limit, kinds=kinds):
        detail = r["sig"] or r["doc"]
        print(f"{r['kind']:<10} {r['name']}  {g.loc(r)}" + (f"\n           {clip(detail, 150)}" if detail and r["kind"] not in ("file",) else ""))


def cmd_sym(g: Graph, args) -> None:
    n = g.must(" ".join(args))
    print(f"{n['kind']} {n['name']}  {n['file']}:{n['start']}-{n['end']}" + (f"  area #{n['area']}" if n["area"] else ""))
    if n["sig"]:
        print(f"sig: {clip(n['sig'], 400)}")
    if n["doc"]:
        print(f"doc: {clip(n['doc'], 400)}")
    nid = n["id"]
    if n["kind"] in ("file", "test-file"):
        return cmd_file(g, [nid])
    if n["kind"] == "table":
        return cmd_table(g, [n["name"]])
    if n["kind"] == "adr":
        return cmd_adr(g, [nid])
    listing(g, "called/rendered by", g.inc(nid, ("CALLS", "RENDERS")), 12)
    listing(g, "calls/renders", g.out(nid, ("CALLS", "RENDERS")), 12)
    listing(g, "used as type by", g.inc(nid, ("USES_TYPE",)), 10)
    listing(g, "uses types", g.out(nid, ("USES_TYPE", "EXTENDS", "IMPLEMENTS")), 8)
    listing(g, "data", g.out(nid, ("USES_TABLE", "CALLS_RPC")), 10, lambda r: f"{r['kind']} {r['name']}")
    listing(g, "handles routes", g.out(nid, ("HANDLES",)), 15, lambda r: r["name"])
    tests = g.tests_for_file(n["file"])
    named = g.q("select * from nodes where kind='test' and name like ? order by file limit 8", f"%{n['name'].split('.')[-1]}%")
    listing(g, "test files covering its file", [g.node(t) for t in tests], 6, lambda r: r["id"])
    listing(g, "test cases naming it", named, 8, lambda r: f"{clip(r['name'], 90)}  {g.loc(r)}")
    listing(g, "docs mentioning it", g.inc(nid, ("MENTIONS",)), 6, lambda r: f"{clip(r['name'], 80)}  {g.loc(r)}")


def cmd_body(g: Graph, args) -> None:
    full = "--all" in args
    args = [a for a in args if a != "--all"]
    n = g.must(" ".join(args))
    if not n["file"]:
        sys.exit("no source for this node")
    lines = (ROOT / n["file"]).read_text(errors="replace").splitlines()
    start, end = max(n["start"], 1), max(n["end"], n["start"])
    if n["kind"] in ("file", "test-file", "doc", "migration", "adr"):
        start, end = 1, len(lines)
    cap = 10**9 if full else 250
    print(f"# {n['file']}:{start}-{end}")
    for i in range(start - 1, min(end, start - 1 + cap)):
        print(f"{i + 1:>5} {lines[i]}")
    if end - start + 1 > cap:
        print(f"# … {end - start + 1 - cap} more lines (--all, or use kg.py file / Read with offset)")


def cmd_file(g: Graph, args) -> None:
    n = g.must(" ".join(args), kinds=("file", "test-file", "migration", "doc", "adr"))
    f = n["file"]
    area = f"  area #{n['area']}" if n["area"] else ""
    print(f"{f}  ({n['end']} lines){area}")
    if n["doc"]:
        print(f"doc: {clip(n['doc'], 300)}")
    syms = g.q("select * from nodes where file=? and kind in ('function','component','class','method','interface','type','enum','const','table','sqlfn') order by start", f)
    if syms:
        print(f"symbols ({len(syms)}):")
        for s in syms:
            exp = "export " if s["exported"] else ""
            print(f"  {s['start']:>5} {exp}{s['kind']} {s['name']}" + (f" — {clip(s['sig'], 90)}" if s["kind"] in ("function", "method", "sqlfn") else ""))
    tests = g.q("select * from nodes where file=? and kind='test' order by start", f)
    listing(g, "test cases", tests, 25, lambda r: f"{r['start']}: {clip(r['name'], 100)}")
    listing(g, "imports", g.out(f, ("IMPORTS",)), 25, lambda r: r["id"])
    listing(g, "imported by", g.inc(f, ("IMPORTS",)), 20, lambda r: r["id"])
    listing(g, "tested by", [g.node(t) for t in g.tests_for_file(f)], 8, lambda r: r["id"])
    listing(g, "packages", g.out(f, ("USES_PACKAGE",)), 12, lambda r: r["name"])
    listing(g, "defines (sql)", g.out(f, ("DEFINES",)) if n["kind"] == "migration" else [], 30, lambda r: f"{r['kind']} {r['name']}")
    listing(g, "cites decisions", g.out(f, ("CITES",)), 8, lambda r: f"{r['id']} {clip(r['name'], 70)}")
    listing(g, "mentioned in docs", g.inc(f, ("MENTIONS",)), 6, lambda r: f"{clip(r['name'], 80)}  {g.loc(r)}")


def tree(g: Graph, nid: str, depth: int, reverse: bool, rels=("CALLS", "RENDERS")) -> None:
    seen = {nid}

    def walk(cur: str, d: int, indent: str) -> None:
        rows = g.inc(cur, rels) if reverse else g.out(cur, rels)
        for i, r in enumerate(rows):
            if i == 25:
                print(f"{indent}… {len(rows) - 25} more")
                break
            mark = " (seen)" if r["id"] in seen else ""
            print(f"{indent}{r['name']}  {g.loc(r)}{mark}")
            if not mark and d > 1:
                seen.add(r["id"])
                walk(r["id"], d - 1, indent + "  ")

    walk(nid, depth, "  ")


def depth_arg(args, default):
    if "-d" in args:
        i = args.index("-d")
        return int(args[i + 1]), args[:i] + args[i + 2 :]
    return default, args


def cmd_callers(g: Graph, args) -> None:
    d, args = depth_arg(args, 2)
    n = g.must(" ".join(args))
    print(f"callers of {g.label(n)}")
    tree(g, n["id"], d, True)


def cmd_callees(g: Graph, args) -> None:
    d, args = depth_arg(args, 1)
    n = g.must(" ".join(args))
    print(f"callees of {g.label(n)}")
    tree(g, n["id"], d, False)


def cmd_impact(g: Graph, args) -> None:
    d, args = depth_arg(args, 3)
    n = g.must(" ".join(args))
    start = [n["id"]]
    if n["kind"] in ("file", "test-file"):
        start += [r["id"] for r in g.out(n["id"], ("DEFINES",))]
    if n["kind"] == "table":
        rels = ("USES_TABLE", "CALLS_RPC") + CODE_RELS
    else:
        rels = CODE_RELS + ("IMPORTS",)
    frontier, seen = list(start), set(start)
    by_level = []
    for _ in range(d):
        nxt = []
        for cur in frontier:
            for r in g.inc(cur, rels):
                if r["id"] not in seen:
                    seen.add(r["id"])
                    nxt.append(r["id"])
            # Reaching a SQL function means its callers are impacted too.
        by_level.append(nxt)
        frontier = nxt
    files = collections.defaultdict(list)
    for lvl, ids in enumerate(by_level, 1):
        for i in ids:
            r = g.node(i)
            if r and r["file"]:
                files[r["file"]].append((lvl, r))
    print(f"impact of {g.label(n)} (depth {d}): {sum(map(len, by_level))} dependents in {len(files)} files")
    for f, items in sorted(files.items(), key=lambda kv: (min(l for l, _ in kv[1]), kv[0])):
        names = ", ".join(sorted({r["name"] for _, r in items if r["kind"] not in ("file", "test-file")})[:6])
        print(f"  [{min(l for l, _ in items)}] {f}" + (f": {names}" if names else ""))
    tests = set()
    for f in list(files) + [n["file"]]:
        if ".test." in f:
            tests.add(f)
        tests.update(g.tests_for_file(f))
    if tests:
        print(f"tests to run ({len(tests)}):")
        for t in sorted(tests):
            print(f"  - {t}")


def cmd_path(g: Graph, args) -> None:
    if len(args) < 2:
        sys.exit("usage: kg.py path <a> <b>")
    a, b = g.must(args[0]), g.must(args[1])
    semantic = CODE_RELS + ("USES_TABLE", "CALLS_RPC", "REFERENCES", "HANDLES")
    # Prefer real call/type/data edges; fall back to file containment and imports.
    for rels in (semantic, semantic + ("IMPORTS", "DEFINES")):
        if shortest(g, a, b, rels):
            return
    print("no connection found")


def shortest(g: Graph, a, b, rels) -> bool:
    adj = collections.defaultdict(list)
    for r in g.q(f"select src, dst, rel from edges where rel in ({','.join('?' * len(rels))})", *rels):
        adj[r["src"]].append((r["dst"], r["rel"], "->"))
        adj[r["dst"]].append((r["src"], r["rel"], "<-"))
    prev: dict = {a["id"]: None}
    queue = collections.deque([a["id"]])
    while queue:
        cur = queue.popleft()
        if cur == b["id"]:
            break
        for nxt, rel, d in adj[cur]:
            if nxt not in prev:
                prev[nxt] = (cur, rel, d)
                queue.append(nxt)
    if b["id"] not in prev:
        return False
    chain, cur = [], b["id"]
    while prev[cur]:
        p, rel, d = prev[cur]
        chain.append((p, rel, d, cur))
        cur = p
    chain.reverse()
    print(f"{len(chain)} hops:")
    print(f"  {g.label(a)}")
    for p, rel, d, c in chain:
        n = g.node(c)
        arrow = f"-{rel}->" if d == "->" else f"<-{rel}-"
        print(f"  {arrow} {g.label(n)}")
    return True


def cmd_table(g: Graph, args) -> None:
    n = g.must(" ".join(args), kinds=("table", "sqlfn"))
    print(f"{n['kind']} {n['name']}  first defined {n['file']}:{n['start']}")
    print(f"sig: {n['sig']}")
    if n["doc"]:
        print(n["doc"])
    nid = n["id"]
    listing(g, "references", g.out(nid, ("REFERENCES",)), 15, lambda r: r["name"])
    listing(g, "referenced by", g.inc(nid, ("REFERENCES",)), 15, lambda r: r["name"])
    listing(g, "migrations", g.inc(nid, ("DEFINES", "ALTERS")), 15, lambda r: r["id"])
    sqlfns = [r for r in g.inc(nid, ("USES_TABLE",)) if r["kind"] == "sqlfn"]
    listing(g, "sql functions using it", sqlfns if n["kind"] == "table" else [], 15, lambda r: r["name"])
    code = [r for r in g.inc(nid, ("USES_TABLE", "CALLS_RPC")) if r["kind"] != "sqlfn"]
    listing(g, "code using it", code, 15)
    if n["kind"] == "sqlfn":
        listing(g, "tables it touches", g.out(nid, ("USES_TABLE",)), 15, lambda r: r["name"])


def cmd_route(g: Graph, args) -> None:
    prefix = args[0] if args else "/"
    rows = g.q("select * from nodes where kind='route' and name like ? order by name", f"{prefix}%")
    for r in rows:
        handlers = g.inc(r["id"], ("HANDLES",))
        print(f"{r['name']}  <- " + ", ".join(f"{h['name']} {g.loc(h)}" for h in handlers[:3]))


def cmd_adr(g: Graph, args) -> None:
    text = " ".join(args)
    n, _ = g.resolve(text, kinds=("adr",))
    if not n:
        hits = g.search(text, limit=1, kinds=("section",))
        n = g.node(hits[0]["id"].split("§")[0]) if hits else None
    if not n:
        sys.exit(f"no decision matches {text!r}")
    print(f"{n['id']} {n['name']}  {n['file']}")
    if n["sig"]:
        print(f"status: {clip(n['sig'], 250)}")
    secs = g.out(n["id"], ("HAS_SECTION",))
    print("sections: " + "; ".join(f"{s['name'].split(' › ')[-1]} :{s['start']}" for s in sorted(secs, key=lambda s: s["start"])))
    named = collections.OrderedDict()
    for s in secs:
        for r in g.out(s["id"], ("MENTIONS",)):
            named[r["id"]] = r
    listing(g, "names code/data", list(named.values()), 25, lambda r: f"{r['kind']} {r['name']}  {g.loc(r)}")
    listing(g, "cited by", g.inc(n["id"], ("CITES",)), 20, lambda r: r["id"])
    listing(g, "referenced by docs", [r for r in g.inc(n["id"], ("MENTIONS",)) if not r["id"].startswith(n["id"])], 10,
            lambda r: f"{clip(r['name'], 80)}  {g.loc(r)}")


def cmd_area(g: Graph, args) -> None:
    if not args:
        for a in g.q("select * from areas order by id"):
            print(f"#{a['id']} {a['name']} ({a['size']} files)")
        return
    a = g.q("select * from areas where id=?", int(args[0].lstrip("#")))
    if not a:
        sys.exit("no such area")
    a = a[0]
    print(f"#{a['id']} {a['name']} ({a['size']} files)")
    print(a["summary"])
    files = g.q("select id from nodes where area=? and kind in ('file','test-file') order by id", a["id"])
    print("files: " + ", ".join(f["id"] for f in files))


def cmd_stats(g: Graph, args) -> None:
    for r in g.q("select key, value from meta order by key"):
        print(f"{r['key']}: {r['value']}")


COMMANDS = {
    "overview": cmd_overview, "search": cmd_search, "s": cmd_search, "sym": cmd_sym, "body": cmd_body,
    "file": cmd_file, "callers": cmd_callers, "callees": cmd_callees, "impact": cmd_impact, "path": cmd_path,
    "table": cmd_table, "route": cmd_route, "adr": cmd_adr, "area": cmd_area, "stats": cmd_stats,
}


def main() -> None:
    args = sys.argv[1:]
    refresh = "--no-refresh" not in args
    args = [a for a in args if a != "--no-refresh"]
    if not args or args[0] not in COMMANDS:
        print((__doc__ or "").strip())
        sys.exit(0 if not args else 2)
    if refresh and build.stored_fingerprint() != build.fingerprint():
        print("# graph stale, rebuilding…", file=sys.stderr)
        build.build(quiet=True)
    if not build.DB_PATH.exists():
        sys.exit("no graph yet: python3 scripts/knowledge-graph/build.py")
    COMMANDS[args[0]](Graph(), args[1:])


if __name__ == "__main__":
    main()
