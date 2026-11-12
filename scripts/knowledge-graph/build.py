#!/usr/bin/env python3
"""Build the Open Media knowledge graph into .knowledge/graph.sqlite.

Layers (all deterministic, no LLM or embedding calls):
  code   - extract.ts (TypeScript type checker): files, symbols, CALLS/RENDERS/IMPORTS/
           USES_TYPE/EXTENDS edges, test cases, Worker routes, table and RPC usage
  sql    - supabase/migrations: tables, columns, foreign keys, SQL functions, RLS policies
  docs   - Markdown (ADRs, docs/, READMEs): sections linked to the files, symbols, tables
           and ADRs they mention; "ADR nnnn" comments in code link code to decisions
  areas  - Louvain communities over the file graph, each with an extractive summary card
  search - SQLite FTS5 (BM25) over names, split identifiers, signatures, docs and sections

Usage: python3 scripts/knowledge-graph/build.py [--if-stale] [--quiet]
"""
from __future__ import annotations

import collections
import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / ".knowledge"
DB_PATH = OUT_DIR / "graph.sqlite"
SCHEMA_VERSION = "1"


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True, check=True).stdout


def fingerprint() -> str:
    """Changes whenever a tracked file's content changes (committed or not)."""
    h = hashlib.sha256(SCHEMA_VERSION.encode())
    h.update(git("ls-files", "-s").encode())
    for line in git("status", "--porcelain", "--untracked-files=all").splitlines():
        rel = line[3:].split(" -> ")[-1].strip('"')
        if not rel.endswith((".ts", ".tsx", ".sql", ".md")):
            continue  # only file types the graph indexes (editor state etc. would cause rebuild loops)
        p = ROOT / rel
        try:
            st = p.stat()
            h.update(f"{p}:{st.st_mtime_ns}:{st.st_size}".encode())
        except FileNotFoundError:
            h.update(f"{p}:gone".encode())
    for name in ("extract.ts", "build.py"):
        p = ROOT / "scripts/knowledge-graph" / name
        h.update(f"{name}:{p.stat().st_mtime_ns}".encode())
    return h.hexdigest()[:16]


def stored_fingerprint() -> str | None:
    if not DB_PATH.exists():
        return None
    try:
        con = sqlite3.connect(DB_PATH)
        row = con.execute("select value from meta where key='fingerprint'").fetchone()
        con.close()
        return row[0] if row else None
    except sqlite3.Error:
        return None


def split_words(name: str) -> str:
    parts = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", re.sub(r"([A-Z]+)([A-Z][a-z])", r"\1 \2", name))
    return re.sub(r"[_\-./#:]+", " ", parts).lower()


# ---------------------------------------------------------------- SQL layer

SQL_TABLE = re.compile(r"create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?([\w.\"]+)\s*\(", re.I)
SQL_FN = re.compile(r"create\s+(?:or\s+replace\s+)?function\s+([\w.\"]+)\s*\(", re.I)
SQL_ALTER_ADD = re.compile(r"alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w.\"]+)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?(\w+)", re.I)
SQL_ALTER = re.compile(r"alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?([\w.\"]+)", re.I)
SQL_POLICY = re.compile(r"create\s+policy\s+\"?([^\"\n]+?)\"?\s+on\s+([\w.\"]+)", re.I)
SQL_REF = re.compile(r"references\s+([\w.\"]+)", re.I)
SQL_BODY_TABLE = re.compile(r"\b(?:from|join|into|update)\s+([a-z_][\w.]*)", re.I)
SQL_KEYWORDS = {"constraint", "primary", "unique", "check", "foreign", "exclude", "like"}


def bare(name: str) -> str:
    return name.replace('"', "").split(".")[-1].lower()


def balanced(text: str, start: int) -> str:
    depth, i = 0, start
    while i < len(text):
        c = text[i]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1 : i]
        i += 1
    return text[start + 1 :]


def parse_sql(files: list[str]):
    tables: dict[str, dict] = {}
    fns: dict[str, dict] = {}
    edges: list[tuple[str, str, str]] = []
    nodes: list[dict] = []
    for f in sorted(files):
        text = (ROOT / f).read_text(errors="replace")
        nodes.append(dict(id=f, kind="migration", name=Path(f).name, file=f, start=1, end=text.count("\n") + 1, sig="", doc=""))

        def ln(pos: int) -> int:
            return text.count("\n", 0, pos) + 1

        for m in SQL_TABLE.finditer(text):
            name = bare(m.group(1))
            body = balanced(text, m.end() - 1)
            cols = []
            for part in re.split(r",\s*\n", body):
                tok = part.strip().split()
                if tok and tok[0].lower().strip('"') not in SQL_KEYWORDS:
                    cols.append(tok[0].strip('"'))
            t = tables.setdefault(name, dict(schema=m.group(1).replace('"', ""), cols=[], policies=[], file=f, line=ln(m.start()), migrations=[]))
            t["cols"] += [c for c in cols if c not in t["cols"]]
            for r in SQL_REF.finditer(body):
                edges.append((f"table:{name}", f"table:{bare(r.group(1))}", "REFERENCES"))
            edges.append((f, f"table:{name}", "DEFINES"))
        for m in SQL_ALTER_ADD.finditer(text):
            t = tables.setdefault(bare(m.group(1)), dict(schema=m.group(1), cols=[], policies=[], file=f, line=ln(m.start()), migrations=[]))
            if m.group(2) not in t["cols"]:
                t["cols"].append(m.group(2))
        for m in SQL_ALTER.finditer(text):
            edges.append((f, f"table:{bare(m.group(1))}", "ALTERS"))
        for m in SQL_POLICY.finditer(text):
            name = bare(m.group(2))
            if name in tables:
                tables[name]["policies"].append(m.group(1).strip())
        for m in SQL_FN.finditer(text):
            name = bare(m.group(1))
            args = balanced(text, m.end() - 1)
            end = text.find("$$;", m.end())
            end2 = text.find("$function$;", m.end())
            stop = min([e for e in (end, end2) if e >= 0] or [len(text)])
            body = text[m.end() : stop]
            fns[name] = dict(file=f, line=ln(m.start()), end=ln(stop), sig=f"{m.group(1)}({' '.join(args.split())[:180]})")
            edges.append((f, f"sqlfn:{name}", "DEFINES"))
            for t in set(bare(x) for x in SQL_BODY_TABLE.findall(body)):
                edges.append((f"sqlfn:{name}", f"table:{t}", "USES_TABLE"))
    for name, t in tables.items():
        pol = f" RLS policies: {'; '.join(t['policies'][:8])}." if t["policies"] else ""
        nodes.append(dict(id=f"table:{name}", kind="table", name=name, file=t["file"], start=t["line"], end=t["line"],
                          sig=f"{t['schema']}({', '.join(t['cols'])})"[:600], doc=f"{len(t['cols'])} columns.{pol}"))
    for name, fn in fns.items():
        nodes.append(dict(id=f"sqlfn:{name}", kind="sqlfn", name=name, file=fn["file"], start=fn["line"], end=fn["end"], sig=fn["sig"], doc=""))
    known = {n["id"] for n in nodes}
    edges = [e for e in edges if e[1] in known or e[1].startswith("table:")]
    return nodes, edges


# ---------------------------------------------------------------- docs layer

HEADING = re.compile(r"^(#{1,4})\s+(.+?)\s*#*\s*$")
ADR_REF = re.compile(r"\bADR[\s-]?0*(\d{1,4})\b")
BACKTICK = re.compile(r"`([^`\n]{2,120})`")
MDLINK = re.compile(r"\]\(([^)\s#]+)")


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def parse_docs(md_files: list[str], tracked: set[str], sym_by_name: dict[str, list[str]], tables: set[str]):
    nodes, edges, fts = [], [], []
    basenames = collections.defaultdict(list)
    for t in tracked:
        basenames[Path(t).name].append(t)

    def link_targets(text: str, base: str):
        out = set()
        for m in MDLINK.finditer(text):
            target = os.path.normpath(os.path.join(os.path.dirname(base), m.group(1))).replace(os.sep, "/")
            if target in tracked:
                out.add(target)
        for m in BACKTICK.finditer(text):
            tok = m.group(1).strip().rstrip("()")
            if tok in tracked:
                out.add(tok)
            elif "/" not in tok and len(basenames.get(tok, [])) == 1:
                out.add(basenames[tok][0])
            elif re.fullmatch(r"[A-Za-z_$][\w$.]*", tok):
                ids = sym_by_name.get(tok, [])
                if 0 < len(ids) <= 3:
                    out.update(ids)
                elif tok.lower() in tables:
                    out.add(f"table:{tok.lower()}")
        for m in ADR_REF.finditer(text):
            out.add(f"adr:{int(m.group(1)):04d}")
        return out

    for f in sorted(md_files):
        lines = (ROOT / f).read_text(errors="replace").splitlines()
        adr = re.match(r"docs/adrs/(\d{4})-", f)
        title = next((m.group(2) for m in map(HEADING.match, lines) if m), Path(f).stem)
        status = next((l.split(":", 1)[1].strip(" *") for l in lines[:12] if l.lower().startswith("- status:")), "")
        doc_id = f"adr:{adr.group(1)}" if adr else f
        intro = " ".join(l.strip() for l in lines[1:30] if l.strip() and not l.startswith("#"))[:320]
        nodes.append(dict(id=doc_id, kind="adr" if adr else "doc", name=title, file=f, start=1, end=len(lines),
                          sig=clean(status)[:200] if adr else "", doc=clean(intro)))
        if adr:
            edges.append((f, doc_id, "IS"))
        # Sections = parent chunks (stored by line range; text indexed in FTS).
        heads = [(i, HEADING.match(l)) for i, l in enumerate(lines)]
        heads = [(i, m) for i, m in heads if m and len(m.group(1)) >= 2]
        bounds = [i for i, _ in heads] + [len(lines)]
        if not heads:
            fts.append((doc_id, title, split_words(title), "", "\n".join(lines)[:20000], f))
        for k, (i, m) in enumerate(heads):
            sec_text = "\n".join(lines[i : bounds[k + 1]])
            sid = f"{doc_id}§{slug(m.group(2))}"
            first = " ".join(l.strip() for l in lines[i + 1 : bounds[k + 1]] if l.strip())[:240]
            nodes.append(dict(id=sid, kind="section", name=f"{title} › {m.group(2)}", file=f, start=i + 1, end=bounds[k + 1], sig="", doc=clean(first)))
            edges.append((doc_id, sid, "HAS_SECTION"))
            for t in link_targets(sec_text, f):
                if t != doc_id:
                    edges.append((sid, t, "MENTIONS"))
            fts.append((sid, m.group(2), split_words(m.group(2)) + " " + split_words(title), "", sec_text[:20000], f))
        for t in link_targets("\n".join(lines[: bounds[0]]), f):
            if t != doc_id:
                edges.append((doc_id, t, "MENTIONS"))
    return nodes, edges, fts


def clean(s: str) -> str:
    return re.sub(r"[*_`]", "", re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", s)).strip()


# ---------------------------------------------------------------- build

def build(quiet: bool = False) -> None:
    t0 = time.time()
    fp = fingerprint()
    tracked = {f for f in git("ls-files", "--cached", "--others", "--exclude-standard").splitlines() if (ROOT / f).is_file()}
    proc = subprocess.run(["node", "--import", "tsx", "scripts/knowledge-graph/extract.ts", "."], cwd=ROOT, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"extract.ts failed:\n{proc.stderr[-2000:]}")
    nodes: dict[str, dict] = {}
    edges: set[tuple[str, str, str]] = set()
    tests: list[dict] = []
    routes: list[dict] = []
    for line in proc.stdout.splitlines():
        o = json.loads(line)
        t = o.pop("t")
        if t == "file":
            nodes[o["path"]] = dict(id=o["path"], kind="test-file" if o["test"] else "file", name=Path(o["path"]).name, file=o["path"],
                                    start=1, end=o["lines"], sig="", doc=o["doc"])
        elif t == "sym":
            nodes[o["id"]] = dict(id=o["id"], kind=o["kind"], name=o["name"], file=o["file"], start=o["start"], end=o["end"],
                                  sig=o["sig"], doc=o["doc"], exported=o["exported"])
            edges.add((o["file"], o["id"], "DEFINES"))
        elif t == "edge":
            edges.add((o["src"], o["dst"], o["rel"]))
        elif t == "test":
            tests.append(o)
        elif t == "route":
            routes.append(o)

    # Tests: test-case nodes under their file.
    for o in tests:
        tid = f"{o['file']}::{o['line']}"
        nodes[tid] = dict(id=tid, kind="test", name=o["name"], file=o["file"], start=o["line"], end=o["line"], sig="", doc="")
        edges.add((o["file"], tid, "HAS_TEST"))

    # Routes: server-side only (owner under services/, not a test).
    for o in routes:
        owner_file = o["owner"].split("#")[0]
        if not owner_file.startswith("services/") or ".test." in owner_file:
            continue
        rid = f"route:{o['path']}"
        nodes.setdefault(rid, dict(id=rid, kind="route", name=o["path"], file=owner_file, start=o["line"], end=o["line"], sig="", doc=""))
        edges.add((o["owner"], rid, "HANDLES"))

    # Packages.
    for s, d, r in list(edges):
        if d.startswith("pkg:") and d not in nodes:
            nodes[d] = dict(id=d, kind="package", name=d[4:], file="", start=0, end=0, sig="", doc="")

    # SQL.
    migrations = [f for f in tracked if f.startswith("supabase/migrations/") and f.endswith(".sql")]
    migrations += [f for f in tracked if f.startswith("services/mail-sync/migrations/") and f.endswith(".sql")]
    sql_nodes, sql_edges = parse_sql(migrations)
    for n in sql_nodes:
        nodes[n["id"]] = n
    edges.update(sql_edges)
    for s, d, r in list(edges):
        if (d.startswith("table:") or d.startswith("sqlfn:")) and d not in nodes:
            edges.discard((s, d, r))  # code string that isn't a real table/function

    # Docs.
    sym_by_name: dict[str, list[str]] = collections.defaultdict(list)
    for n in nodes.values():
        if n["kind"] in {"function", "component", "class", "interface", "type", "enum", "const", "method"} and n.get("exported", n["kind"] == "method"):
            sym_by_name[n["name"]].append(n["id"])
    md = [f for f in tracked if f.endswith(".md") and not f.startswith("agent-plugin/skills/")]
    tables = {n["name"] for n in nodes.values() if n["kind"] == "table"}
    doc_nodes, doc_edges, doc_fts = parse_docs(md, tracked, sym_by_name, tables)
    for n in doc_nodes:
        nodes[n["id"]] = n
    edges.update(doc_edges)

    # Code comments that cite ADRs.
    adrs = {n["id"] for n in nodes.values() if n["kind"] == "adr"}
    for f in tracked:
        if f.endswith((".ts", ".tsx", ".sql")):
            try:
                text = (ROOT / f).read_text(errors="replace")
            except OSError:
                continue
            for m in set(ADR_REF.findall(text)):
                a = f"adr:{int(m):04d}"
                if a in adrs:
                    edges.add((f, a, "CITES"))

    edges = {e for e in edges if e[0] in nodes and e[1] in nodes}

    # ------------------------------------------------ ranking + communities
    import networkx as nx

    g = nx.DiGraph()
    for s, d, r in edges:
        if r in {"CALLS", "RENDERS", "USES_TYPE", "IMPORTS", "EXTENDS", "IMPLEMENTS", "USES_TABLE", "CALLS_RPC", "REFERENCES", "HANDLES"}:
            g.add_edge(s, d)
    rank = nx.pagerank(g, alpha=0.85, max_iter=200) if g.number_of_nodes() else {}

    def file_of(nid: str) -> str | None:
        n = nodes.get(nid)
        if not n or n["kind"] in {"package", "adr", "doc", "section", "route"} or not n["file"]:
            return None
        if n["kind"] in {"table", "sqlfn", "migration"}:
            return None
        return n["file"]

    fg = nx.Graph()
    code_files = [n["id"] for n in nodes.values() if n["kind"] in {"file", "test-file"}]
    fg.add_nodes_from(code_files)
    weights: dict = collections.defaultdict(float)
    for s, d, r in edges:
        if r in {"IMPORTS", "CALLS", "RENDERS", "USES_TYPE", "EXTENDS"}:
            a, b = file_of(s), file_of(d)
            if a and b and a != b:
                weights[tuple(sorted((a, b)))] += 1.0 if r == "IMPORTS" else 0.25
    for (a, b), w in weights.items():
        fg.add_edge(a, b, weight=min(w, 6.0))
    comms = nx.community.louvain_communities(fg, weight="weight", resolution=1.0, seed=42)
    comms = sorted((sorted(c) for c in comms), key=len, reverse=True)
    file_comm: dict[str, int] = {}
    areas = []
    small: list[str] = []
    for c in comms:
        if len(c) < 3:
            small += c
            continue
        cid = len(areas) + 1
        for f in c:
            file_comm[f] = cid
        areas.append(c)
    if small:
        areas.append(sorted(small))
        for f in small:
            file_comm[f] = len(areas)

    out_by: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    in_by: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for s, d, r in edges:
        out_by[s].append((d, r))
        in_by[d].append((s, r))

    def file_rank(f: str) -> float:
        return rank.get(f, 0) + sum(rank.get(d, 0) for d, r in out_by[f] if r == "DEFINES")

    area_rows = []
    for idx, files in enumerate(areas, start=1):
        is_misc = idx == len(areas) and bool(small)
        dirs = collections.Counter(os.path.dirname(f) for f in files)
        top_dir = dirs.most_common(1)[0][0] if dirs else ""
        hubs = sorted((f for f in files if ".test." not in f), key=file_rank, reverse=True)[:6]
        toks = collections.Counter()
        for f in files:
            for w in split_words(Path(f).stem).split():
                if len(w) > 2 and w not in {"test", "index", "use", "the", "and", "for"}:
                    toks[w] += 1
        name = "misc (small clusters)" if is_misc else f"{top_dir or '.'}: {' '.join(w for w, _ in toks.most_common(3))}"
        syms = [d for f in files for d, r in out_by[f] if r == "DEFINES" and nodes[d].get("exported")]
        key_syms = sorted(syms, key=lambda s: rank.get(s, 0), reverse=True)[:8]
        adr_ids = collections.Counter(d for f in files for d, r in out_by[f] if r == "CITES")
        for f in files:
            for s, r in in_by[f]:
                if r == "MENTIONS" and nodes[s]["kind"] == "section" and nodes[s]["id"].startswith("adr:"):
                    adr_ids[s.split("§")[0]] += 1
        tabs = collections.Counter()
        for f in files:
            for sid in [f] + [d for d, r in out_by[f] if r == "DEFINES"]:
                for d, r in out_by[sid]:
                    if r in {"USES_TABLE", "CALLS_RPC"}:
                        tabs[nodes[d]["name"]] += 1
        rts = sorted({d for f in files for sid in [f] + [x for x, r in out_by[f] if r == "DEFINES"] for d, r in out_by[sid] if r == "HANDLES"})
        deps: dict = collections.defaultdict(float)
        for (a, b), w in weights.items():
            ca, cb = file_comm.get(a), file_comm.get(b)
            if ca and cb and ca != cb:
                if ca == idx:
                    deps[cb] += w
                if cb == idx:
                    deps[ca] += w
        ntests = sum(1 for f in files if ".test." in f)
        docline = next((nodes[f]["doc"] for f in hubs if nodes[f]["doc"]), "")
        parts = [f"{len(files)} files ({ntests} tests), mostly in {', '.join(d or '.' for d, _ in dirs.most_common(3))}."]
        if docline:
            parts.append(f"Hub says: {docline[:220].rstrip('.')}.")
        parts.append("Hubs: " + ", ".join(hubs) + ".")
        if key_syms:
            parts.append("Key symbols: " + ", ".join(nodes[s]["name"] for s in key_syms) + ".")
        if adr_ids:
            parts.append("Decisions: " + ", ".join(f"{a} {nodes[a]['name'].split(':', 1)[-1].strip()[:60]}" for a, _ in adr_ids.most_common(4)) + ".")
        if tabs:
            parts.append("Data: " + ", ".join(t for t, _ in tabs.most_common(8)) + ".")
        if rts:
            parts.append("Routes: " + ", ".join(nodes[r]["name"] for r in rts[:10]) + (" …" if len(rts) > 10 else "") + ".")
        if deps:
            parts.append("Coupled with areas: " + ", ".join(f"#{c}" for c, _ in sorted(deps.items(), key=lambda kv: -kv[1])[:5]) + ".")
        area_rows.append((idx, name, len(files), " ".join(parts), json.dumps(hubs)))

    # ------------------------------------------------ write SQLite
    OUT_DIR.mkdir(exist_ok=True)
    tmp = DB_PATH.with_suffix(".tmp")
    if tmp.exists():
        tmp.unlink()
    con = sqlite3.connect(tmp)
    con.executescript(
        """
        pragma journal_mode=off; pragma synchronous=off;
        create table nodes(id text primary key, kind text, name text, file text, start int, end int,
                           exported int, sig text, doc text, area int, rank real);
        create table edges(src text, dst text, rel text);
        create table areas(id int primary key, name text, size int, summary text, hubs text);
        create table meta(key text primary key, value text);
        create virtual table fts using fts5(id unindexed, name, words, sig, body, path, tokenize='porter unicode61');
        """
    )
    for n in nodes.values():
        area = file_comm.get(n["file"]) if n["kind"] not in {"adr", "doc", "section", "package"} else None
        con.execute("insert into nodes values (?,?,?,?,?,?,?,?,?,?,?)",
                    (n["id"], n["kind"], n["name"], n["file"], n["start"], n["end"], int(bool(n.get("exported"))), n["sig"], n["doc"], area, rank.get(n["id"], 0.0)))
    con.executemany("insert into edges values (?,?,?)", sorted(edges))
    con.executescript("create index e_src on edges(src, rel); create index e_dst on edges(dst, rel); create index n_name on nodes(name collate nocase); create index n_file on nodes(file);")
    con.executemany("insert into areas values (?,?,?,?,?)", area_rows)
    for n in nodes.values():
        if n["kind"] in {"section", "package"} or (n["kind"] in {"adr", "doc"}):
            continue
        con.execute("insert into fts values (?,?,?,?,?,?)", (n["id"], n["name"], split_words(n["name"]), n["sig"], n["doc"], n["file"] + " " + split_words(n["file"])))
    for row in doc_fts:
        con.execute("insert into fts values (?,?,?,?,?,?)", row)
    for a in area_rows:
        con.execute("insert into fts values (?,?,?,?,?,?)", (f"area:{a[0]}", a[1], split_words(a[1]), "", a[3], ""))
    head = git("rev-parse", "--short", "HEAD").strip()
    kinds = collections.Counter(n["kind"] for n in nodes.values())
    rels = collections.Counter(r for _, _, r in edges)
    meta = dict(fingerprint=fp, head=head, built_at=time.strftime("%Y-%m-%d %H:%M"), seconds=f"{time.time() - t0:.1f}",
                kinds=json.dumps(kinds), rels=json.dumps(rels))
    con.executemany("insert into meta values (?,?)", meta.items())
    con.commit()
    con.execute("vacuum")
    con.close()
    os.replace(tmp, DB_PATH)
    write_overview(nodes, area_rows, rank, meta, kinds, rels)
    if not quiet:
        print(f"graph built in {meta['seconds']}s at {head}: {len(nodes)} nodes, {len(edges)} edges, {len(area_rows)} areas -> {DB_PATH.relative_to(ROOT)}")


def write_overview(nodes, area_rows, rank, meta, kinds, rels) -> None:
    lines = [f"# Open Media code map (generated {meta['built_at']} at {meta['head']}; do not edit)", ""]
    lines.append("Query: `python3 scripts/knowledge-graph/kg.py <command>` (search, sym, body, file, callers, impact, path, table, route, adr, area, overview).")
    lines.append("")
    lines.append("## Areas (Louvain communities of the import/call graph)")
    for a in area_rows:
        lines.append(f"- #{a[0]} {a[1]} ({a[2]} files): hubs {', '.join(json.loads(a[4])[:3])}")
    lines.append("")
    lines.append("## Most central symbols (PageRank)")
    syms = sorted((n for n in nodes.values() if n["kind"] in {"function", "component", "class", "interface", "type", "const"}), key=lambda n: rank.get(n["id"], 0), reverse=True)[:20]
    for n in syms:
        lines.append(f"- {n['name']} ({n['kind']}) {n['file']}:{n['start']}")
    lines.append("")
    lines.append("## Decisions")
    for n in sorted((n for n in nodes.values() if n["kind"] == "adr"), key=lambda n: n["id"]):
        lines.append(f"- {n['id']} {n['name'].split(':', 1)[-1].strip()}")
    lines.append("")
    lines.append("## Counts")
    lines.append("nodes: " + ", ".join(f"{k} {v}" for k, v in kinds.most_common()))
    lines.append("edges: " + ", ".join(f"{k} {v}" for k, v in rels.most_common()))
    (OUT_DIR / "OVERVIEW.md").write_text("\n".join(lines) + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    if "--if-stale" in args and stored_fingerprint() == fingerprint():
        if "--quiet" not in args:
            print("graph is current")
        sys.exit(0)
    build(quiet="--quiet" in args)
