"""Visualize the knowledge graph: interactive HTML, an Obsidian vault, or GraphML (Gephi).

Called through kg.py:
  kg.py viz [--level area|file|symbol] [--no-open]   whole graph at one level (default: file)
  kg.py viz <name> [-d 2] [--no-open]                 neighbourhood of one symbol/file/table/ADR
  kg.py export obsidian                               .knowledge/vault (open it as a vault)
  kg.py export graphml                                .knowledge/graph.graphml (Gephi, Cytoscape, yEd)
"""
from __future__ import annotations

import collections
import html
import json
import re
import subprocess
import sys
from pathlib import Path

import build

OUT = build.OUT_DIR
SKIP_RELS = {"HAS_SECTION", "IS", "USES_PACKAGE"}
FILE_KINDS = ("file", "test-file")
SYMBOL_KINDS = ("function", "component", "class", "method", "interface", "type", "enum", "const")


def _short(s: str | None, n: int) -> str:
    s = (s or "").replace("\n", " ")
    return s if len(s) <= n else s[: n - 1] + "…"


def _node_json(r, size: float) -> dict:
    loc = r["file"] + (f":{r['start']}" if r["start"] and r["kind"] not in FILE_KINDS else "") if r["file"] else ""
    return {"id": r["id"], "n": r["name"], "k": r["kind"], "a": r["area"] or 0, "f": loc,
            "s": _short(r["sig"], 220), "d": _short(r["doc"], 320), "r": size}


# ---------------------------------------------------------------- graph slices

def slice_area(g):
    areas = g.q("select * from areas order by id")
    file_area = {r["id"]: r["area"] for r in g.q("select id, area from nodes where kind in ('file','test-file')")}
    w = collections.Counter()
    for r in g.q("select n1.file a, n2.file b from edges e join nodes n1 on n1.id=e.src join nodes n2 on n2.id=e.dst "
                 "where e.rel in ('IMPORTS','CALLS','RENDERS','USES_TYPE','REFERENCES')"):
        x, y = file_area.get(r["a"]), file_area.get(r["b"])
        if x and y and x != y:
            w[tuple(sorted((x, y)))] += 1
    nodes = [{"id": f"area:{a['id']}", "n": f"#{a['id']} {a['name']}", "k": "area", "a": a["id"], "f": f"{a['size']} files",
              "s": "", "d": a["summary"], "r": 4 + a["size"] ** 0.5 * 2} for a in areas]
    links = [{"source": f"area:{x}", "target": f"area:{y}", "t": "COUPLED", "w": c} for (x, y), c in w.items() if c >= 3]
    return nodes, links


def slice_file(g):
    rows = g.q("select * from nodes where kind in ('file','test-file','table','adr')")
    ids = {r["id"] for r in rows}
    owner = {r["id"]: r["file"] for r in g.q("select id, file from nodes where kind in (%s)" % ",".join("?" * len(SYMBOL_KINDS)), *SYMBOL_KINDS)}
    sec_doc = {r["id"]: r["id"].split("§")[0] for r in g.q("select id from nodes where kind='section'")}
    rpc_tables = collections.defaultdict(set)
    for r in g.q("select src, dst from edges where rel='USES_TABLE' and src like 'sqlfn:%'"):
        rpc_tables[r["src"]].add(r["dst"])

    def lift(x: str) -> list[str]:
        if x in ids:
            return [x]
        if x in owner:
            return [owner[x]]
        if x in sec_doc:
            return [sec_doc[x]] if sec_doc[x] in ids else []
        if x.startswith("sqlfn:"):
            return sorted(rpc_tables.get(x, ()))
        if "::" in x:  # test case
            return [x.split("::")[0]]
        return []

    w: dict[tuple[str, str], collections.Counter] = collections.defaultdict(collections.Counter)
    for e in g.q("select src, dst, rel from edges"):
        if e["rel"] in SKIP_RELS | {"DEFINES", "HAS_TEST"}:
            continue
        for a in lift(e["src"]):
            for b in lift(e["dst"]):
                if a != b:
                    w[(a, b)][e["rel"]] += 1
    deg = collections.Counter()
    for a, b in w:
        deg[a] += 1
        deg[b] += 1
    nodes = [_node_json(r, 2 + min(deg[r["id"]], 60) ** 0.6) for r in rows if deg[r["id"]]]
    links = [{"source": a, "target": b, "t": c.most_common(1)[0][0], "w": sum(c.values())} for (a, b), c in w.items()]
    return nodes, links


def slice_symbol(g):
    kinds = SYMBOL_KINDS + ("table", "sqlfn", "route", "adr")
    rows = g.q("select * from nodes where kind in (%s)" % ",".join("?" * len(kinds)), *kinds)
    ids = {r["id"] for r in rows}
    links = [{"source": e["src"], "target": e["dst"], "t": e["rel"], "w": 1}
             for e in g.q("select src, dst, rel from edges") if e["src"] in ids and e["dst"] in ids and e["rel"] not in SKIP_RELS]
    deg = collections.Counter()
    for l in links:
        deg[l["source"]] += 1
        deg[l["target"]] += 1
    rows = [r for r in rows if deg[r["id"]]]
    return [_node_json(r, 1.5 + min(deg[r["id"]], 80) ** 0.55) for r in rows], links


def slice_focus(g, center, depth: int, cap: int = 450):
    seen = {center["id"]: 0}
    frontier = [center["id"]]
    for d in range(1, depth + 1):
        nxt = []
        for cur in frontier:
            for e in g.q("select src, dst, rel from edges where src=? or dst=?", cur, cur):
                if e["rel"] in SKIP_RELS:
                    continue
                other = e["dst"] if e["src"] == cur else e["src"]
                if other not in seen:
                    seen[other] = d
                    nxt.append(other)
        frontier = nxt
    rows = [g.node(i) for i in seen]
    rows = [r for r in rows if r]
    if len(rows) > cap:  # keep the closest and most central
        rows.sort(key=lambda r: (seen[r["id"]], -r["rank"]))
        rows = rows[:cap]
    ids = {r["id"] for r in rows}
    marks = ",".join("?" * len(ids))
    links = [{"source": e["src"], "target": e["dst"], "t": e["rel"], "w": 1}
             for e in g.q(f"select src, dst, rel from edges where src in ({marks}) and dst in ({marks})", *ids, *ids) if e["rel"] not in SKIP_RELS]
    nodes = [_node_json(r, 9 if r["id"] == center["id"] else 2.5 + 3 / (1 + seen[r["id"]])) for r in rows]
    return nodes, links


# ---------------------------------------------------------------- HTML

def write_html(g, args: list[str]) -> Path:
    level = "file"
    depth = 2
    if "--level" in args:
        i = args.index("--level")
        level = args[i + 1]
        args = args[:i] + args[i + 2 :]
    if "-d" in args:
        i = args.index("-d")
        depth = int(args[i + 1])
        args = args[:i] + args[i + 2 :]
    no_open = "--no-open" in args
    args = [a for a in args if a != "--no-open"]
    if args:
        center = g.must(" ".join(args))
        nodes, links = slice_focus(g, center, depth)
        title = f"{center['name']} ±{depth}"
        out = OUT / f"graph-{re.sub(r'[^A-Za-z0-9]+', '-', center['name'])[:40]}.html"
    else:
        nodes, links = {"area": slice_area, "file": slice_file, "symbol": slice_symbol}[level](g)
        title = f"{level} level"
        out = OUT / f"graph-{level}.html"
    areas = {a["id"]: a["name"] for a in g.q("select id, name from areas")}
    meta = {r["key"]: r["value"] for r in g.q("select key, value from meta")}
    data = json.dumps({"nodes": nodes, "links": links, "areas": areas, "title": title,
                       "built": f"{meta.get('built_at')} at {meta.get('head')}"}, separators=(",", ":"))
    out.write_text(TEMPLATE.replace("__TITLE__", html.escape(f"Open Media graph: {title}")).replace("__DATA__", data.replace("</", "<\\/")))
    print(f"{out.relative_to(build.ROOT)}: {len(nodes)} nodes, {len(links)} links")
    if not no_open and sys.platform == "darwin":
        subprocess.run(["open", str(out)], check=False)
    return out


TEMPLATE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__TITLE__</title>
<style>
:root{--bg:#f7f7f5;--panel:#ffffffee;--ink:#1d1d1f;--mute:#6b6b70;--line:#d9d9dc;--accent:#2f6fde}
@media (prefers-color-scheme:dark){:root{--bg:#121214;--panel:#1c1c1fee;--ink:#ececf0;--mute:#9a9aa3;--line:#333338;--accent:#7aa7ff}}
*{box-sizing:border-box}html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:hidden}
#graph{position:fixed;inset:0}
.panel{position:fixed;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:10px 12px;backdrop-filter:blur(8px);max-height:calc(100% - 24px);overflow:auto}
#side{top:12px;left:12px;width:260px}#info{top:12px;right:12px;width:360px;display:none}
h1{font-size:14px;margin:0 0 2px}small,.mute{color:var(--mute)}
input[type=search]{width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:transparent;color:var(--ink);margin:8px 0}
.rels label,.legend div{display:flex;gap:6px;align-items:center;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sw{width:10px;height:10px;border-radius:50%;flex:none}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);margin:10px 0 4px}
code{font:11.5px ui-monospace,Menlo,monospace;word-break:break-word}
#info a{color:var(--accent);cursor:pointer;text-decoration:none}#info li{margin:1px 0}#info ul{padding-left:16px;margin:2px 0 6px}
button{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:6px;padding:3px 8px;cursor:pointer;font-size:12px}
@media (max-width:700px){#side{width:auto;right:12px}#info{top:auto;bottom:12px;left:12px;right:12px;width:auto;max-height:45%}}
</style></head><body>
<div id="graph"></div>
<div id="side" class="panel">
  <h1 id="title"></h1><small id="stats"></small>
  <input id="q" type="search" placeholder="Find a node…" autocomplete="off">
  <button id="all" style="display:none">Show everything</button>
  <h2>Links</h2><div class="rels" id="rels"></div>
  <h2>Colour</h2><div class="legend" id="legend"></div>
  <p class="mute" style="margin:10px 0 0">Click a node for details · double-click to focus on its neighbours · scroll to zoom.</p>
</div>
<div id="info" class="panel"></div>
<script src="https://cdn.jsdelivr.net/npm/force-graph@1.43.5/dist/force-graph.min.js"></script>
<script>
const DATA = __DATA__;
const dark = matchMedia('(prefers-color-scheme: dark)').matches;
const KIND_COLOR = {table:'#d98b19', sqlfn:'#e0a64a', adr: dark ? '#f2f2f2' : '#222', doc: dark ? '#bbb' : '#555', section:'#b9a0e6', route:'#18a39a', test:'#9a9aa3', 'test-file':'#8b8b94', migration:'#c47d2a', package:'#777'};
const areaIds = Object.keys(DATA.areas).map(Number).sort((a,b)=>a-b);
const areaColor = id => `hsl(${(areaIds.indexOf(id) * 137.5) % 360} ${dark ? 62 : 58}% ${dark ? 62 : 46}%)`;
const color = n => KIND_COLOR[n.k] && n.k !== 'test-file' ? KIND_COLOR[n.k] : n.a ? areaColor(n.a) : '#888';
document.getElementById('title').textContent = 'Open Media · ' + DATA.title;
const byId = new Map(DATA.nodes.map(n => [n.id, n]));
const relCount = {}; DATA.links.forEach(l => relCount[l.t] = (relCount[l.t] || 0) + 1);
const hidden = new Set(DATA.nodes.length > 2500 ? ['USES_TYPE','REFERENCES','TESTS','MENTIONS'] : []);
const relBox = document.getElementById('rels');
Object.entries(relCount).sort((a,b)=>b[1]-a[1]).forEach(([t,c]) => {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox" ${hidden.has(t)?'':'checked'}> ${t.toLowerCase().replace('_',' ')} <span class="mute">${c}</span>`;
  l.querySelector('input').onchange = e => { e.target.checked ? hidden.delete(t) : hidden.add(t); refresh(); };
  relBox.appendChild(l);
});
const legend = document.getElementById('legend');
const kindsPresent = new Set(DATA.nodes.map(n => n.k));
areaIds.filter(a => DATA.nodes.some(n => n.a === a)).forEach(a => {
  const d = document.createElement('div'); d.innerHTML = `<span class="sw" style="background:${areaColor(a)}"></span>#${a} ${DATA.areas[a]}`;
  d.onclick = () => select(DATA.nodes.find(n => n.id === 'area:' + a) || null, a); legend.appendChild(d);
});
const SHAPE = {table:'■ table', sqlfn:'■ SQL function', adr:'◆ decision (ADR)', doc:'◆ doc'};
Object.entries(KIND_COLOR).filter(([k]) => kindsPresent.has(k) && k !== 'test-file').forEach(([k,c]) => {
  const d = document.createElement('div'); d.innerHTML = `<span style="color:${c}">${(SHAPE[k]||'● '+k).slice(0,1)}</span>${(SHAPE[k]||'● '+k).slice(2)}`; legend.appendChild(d);
});
let focusSet = null, selected = null, hoverSet = null, areaFilter = null;
const adj = new Map(); DATA.links.forEach(l => { for (const [a,b] of [[l.source,l.target],[l.target,l.source]]) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push({id:b, t:l.t, out: a === l.source}); } });
function visibleData() {
  const nodes = DATA.nodes.filter(n => !focusSet || focusSet.has(n.id));
  const ids = new Set(nodes.map(n => n.id));
  const links = DATA.links.filter(l => !hidden.has(l.t) && ids.has(id(l.source)) && ids.has(id(l.target)));
  return {nodes, links};
}
const id = x => typeof x === 'object' ? x.id : x;
const el = document.getElementById('graph');
const G = ForceGraph()(el).backgroundColor(getComputedStyle(document.body).backgroundColor)
  .nodeId('id').nodeVal(n => n.r * n.r).nodeLabel(n => `${n.n} (${n.k})`)
  .nodeColor(n => dim(n) ? (dark ? '#2c2c30' : '#e2e2e5') : color(n))
  .linkColor(l => hoverSet && (hoverSet.has(id(l.source)) && hoverSet.has(id(l.target))) ? (dark ? '#bbb' : '#555') : (dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.12)'))
  .linkWidth(l => Math.min(0.4 + Math.log2(1 + (l.w || 1)) * 0.5, 3)).linkDirectionalArrowLength(DATA.nodes.length < 600 ? 3 : 0).linkDirectionalArrowRelPos(1)
  .nodeCanvasObjectMode(() => 'replace').nodePointerAreaPaint((n, c, ctx) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 1, 0, 2 * Math.PI); ctx.fill(); })
  .nodeCanvasObject((n, ctx, scale) => {
    const r = n.r, faded = dim(n);
    ctx.fillStyle = faded ? (dark ? '#2c2c30' : '#e2e2e5') : color(n);
    ctx.beginPath();
    if (n.k === 'table' || n.k === 'sqlfn') ctx.rect(n.x - r, n.y - r, 2 * r, 2 * r);
    else if (n.k === 'adr' || n.k === 'doc') { ctx.moveTo(n.x, n.y - r * 1.3); ctx.lineTo(n.x + r * 1.3, n.y); ctx.lineTo(n.x, n.y + r * 1.3); ctx.lineTo(n.x - r * 1.3, n.y); ctx.closePath(); }
    else ctx.arc(n.x, n.y, r, 0, 2 * Math.PI);
    ctx.fill();
    if (n === selected) { ctx.lineWidth = 2 / scale; ctx.strokeStyle = dark ? '#fff' : '#000'; ctx.stroke(); }
    const focusLabel = n === selected || (hoverSet && hoverSet.has(n.id) && hoverSet.size < 60);
    if (faded || !(focusLabel || DATA.nodes.length < 80 || scale * r > 14 || scale > 3.5)) return;
    ctx.font = `${Math.max(10 / scale, 1.5)}px -apple-system,sans-serif`; ctx.fillStyle = dark ? '#ddd' : '#222'; ctx.textAlign = 'center';
    const label = n.k === 'adr' ? n.id.replace('adr:', 'ADR ') : n.n;
    ctx.fillText(label.length > 40 ? label.slice(0, 39) + '…' : label, n.x, n.y + n.r + 9 / scale);
  })
  .onNodeHover(n => { hoverSet = n ? new Set([n.id, ...(adj.get(n.id) || []).map(x => x.id)]) : (selected ? new Set([selected.id, ...(adj.get(selected.id)||[]).map(x=>x.id)]) : null); el.style.cursor = n ? 'pointer' : ''; })
  .onNodeClick(n => select(n)).onBackgroundClick(() => select(null))
  .cooldownTicks(DATA.nodes.length > 2000 ? 120 : 300).d3VelocityDecay(0.3);
G.d3Force('charge').strength(DATA.nodes.length > 2000 ? -18 : -70).distanceMax(400);
// Pull each area toward its own anchor so communities read as clusters (ADRs/tables float between them).
const anchors = {}; areaIds.forEach((a, i) => { const t = 2 * Math.PI * i / areaIds.length, R = 90 + 18 * areaIds.length; anchors[a] = [R * Math.cos(t), R * Math.sin(t)]; });
let simNodes = [];
const clusterForce = alpha => { for (const n of simNodes) { const p = anchors[n.a]; if (!p || n.k === 'area') continue; n.vx += (p[0] - n.x) * 0.06 * alpha; n.vy += (p[1] - n.y) * 0.06 * alpha; } };
clusterForce.initialize = ns => { simNodes = ns; };
G.d3Force('cluster', clusterForce);
G.d3Force('link').distance(l => DATA.nodes.length > 2000 ? 18 : 30 + 20 / Math.sqrt(l.w || 1));
let lastClick = 0;
G.onNodeClick(n => { const now = Date.now(); if (now - lastClick < 350 && selected === n) focusOn(n); else select(n); lastClick = now; });
function dim(n) { if (areaFilter) return n.a !== areaFilter; return hoverSet ? !hoverSet.has(n.id) : false; }
function refresh() { G.graphData(visibleData()); document.getElementById('stats').textContent = `${G.graphData().nodes.length} nodes · ${G.graphData().links.length} links · built ${DATA.built}`; }
function focusOn(n) {
  focusSet = new Set([n.id]); let frontier = [n.id];
  for (let d = 0; d < 2; d++) { const nxt = []; frontier.forEach(f => (adj.get(f) || []).forEach(x => { if (!focusSet.has(x.id)) { focusSet.add(x.id); nxt.push(x.id); } })); frontier = nxt; }
  document.getElementById('all').style.display = ''; refresh(); setTimeout(() => G.zoomToFit(600, 40), 900);
}
document.getElementById('all').onclick = () => { focusSet = null; document.getElementById('all').style.display = 'none'; refresh(); setTimeout(() => G.zoomToFit(600, 40), 900); };
const esc = s => (s || '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function select(n, area) {
  selected = n; areaFilter = n ? null : (area || null);
  hoverSet = n ? new Set([n.id, ...(adj.get(n.id) || []).map(x => x.id)]) : null;
  const box = document.getElementById('info');
  if (!n) { box.style.display = area ? '' : 'none'; if (area) box.innerHTML = `<h1>#${area} ${esc(DATA.areas[area])}</h1><p class="mute">Area highlighted. Click the background to clear.</p>`; return; }
  const groups = {}; (adj.get(n.id) || []).forEach(x => { const k = (x.out ? '→ ' : '← ') + x.t.toLowerCase().replace('_',' '); (groups[k] = groups[k] || []).push(x.id); });
  box.style.display = '';
  box.innerHTML = `<h1>${esc(n.n)}</h1><small>${n.k}${n.a ? ` · area #${n.a} ${esc(DATA.areas[n.a] || '')}` : ''}</small>
    ${n.f ? `<p><code>${esc(n.f)}</code></p>` : ''}${n.s ? `<p><code>${esc(n.s)}</code></p>` : ''}${n.d ? `<p>${esc(n.d)}</p>` : ''}
    <p><button id="focusBtn">Focus on neighbours</button></p>` +
    Object.entries(groups).sort((a,b)=>b[1].length-a[1].length).map(([k, ids]) => `<h2>${k} (${ids.length})</h2><ul>${ids.slice(0, 30).map(i => `<li><a data-id="${esc(i)}">${esc((byId.get(i)||{n:i}).n)}</a></li>`).join('')}${ids.length > 30 ? `<li class="mute">… ${ids.length - 30} more</li>` : ''}</ul>`).join('');
  box.querySelector('#focusBtn').onclick = () => focusOn(n);
  box.querySelectorAll('a[data-id]').forEach(a => a.onclick = () => { const m = byId.get(a.dataset.id); if (!m) return; if (focusSet && !focusSet.has(m.id)) focusSet.add(m.id), refresh(); select(m); if (m.x !== undefined) G.centerAt(m.x, m.y, 600); });
}
const q = document.getElementById('q');
q.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; const t = q.value.toLowerCase().trim(); if (!t) return;
  const hit = DATA.nodes.filter(n => n.n.toLowerCase().includes(t) || n.f.toLowerCase().includes(t)).sort((a,b) => (a.n.toLowerCase() === t ? -1 : 0) - (b.n.toLowerCase() === t ? -1 : 0) || b.r - a.r)[0];
  if (!hit) return; if (focusSet && !focusSet.has(hit.id)) { focusSet = null; refresh(); }
  select(hit); setTimeout(() => { if (hit.x !== undefined) { G.centerAt(hit.x, hit.y, 700); G.zoom(4, 700); } }, 50);
});
addEventListener('resize', () => G.width(innerWidth).height(innerHeight));
refresh(); setTimeout(() => G.zoomToFit(700, 40), 1800);
</script></body></html>
"""


# ---------------------------------------------------------------- exports

def _note_name(r) -> str:
    k, name = r["kind"], r["name"]
    if k in FILE_KINDS:
        return "code/" + r["id"].replace("/", " › ")
    if k == "table":
        return f"tables/{name}"
    if k == "adr":
        return f"adrs/{r['id'][4:]} " + re.sub(r'[\\/:*?"<>|#^\[\]]', "", name.split(":", 1)[-1]).strip()[:70]
    return ""


def export_obsidian(g) -> Path:
    vault = OUT / "vault"
    rows = g.q("select * from nodes where kind in ('file','test-file','table','adr')")
    names = {r["id"]: _note_name(r) for r in rows}
    areas = {a["id"]: a for a in g.q("select * from areas")}
    area_note = {i: f"areas/{i:02d} " + re.sub(r'[\\/:*?"<>|#^\[\]]', "", a["name"])[:60] for i, a in areas.items()}
    owner = {r["id"]: r["file"] for r in g.q("select id, file from nodes where kind not in ('file','test-file','table','adr','package')")}
    sec_doc = {r["id"]: r["id"].split("§")[0] for r in g.q("select id from nodes where kind='section'")}

    def lift(x):
        if x in names:
            return x
        if x in sec_doc:
            return sec_doc[x] if sec_doc[x] in names else None
        if x.startswith("sqlfn:") or x.startswith("route:"):
            return None
        return owner.get(x) if owner.get(x) in names else None

    links: dict[str, dict[str, set]] = collections.defaultdict(lambda: collections.defaultdict(set))
    for e in g.q("select src, dst, rel from edges"):
        if e["rel"] in SKIP_RELS | {"DEFINES", "HAS_TEST"}:
            continue
        a, b = lift(e["src"]), lift(e["dst"])
        if a and b and a != b:
            links[a][e["rel"]].add(b)
    for sub in ("code", "tables", "adrs", "areas"):
        (vault / sub).mkdir(parents=True, exist_ok=True)
    written = 0
    for r in rows:
        body = [f"---\ntags: [kind/{r['kind']}" + (f", area/{r['area']:02d}" if r["area"] else "") + "]\n---",
                f"# {r['name']}", f"`{r['file']}`" if r["file"] else ""]
        if r["area"]:
            body.append(f"Area: [[{area_note[r['area']]}|#{r['area']} {areas[r['area']]['name']}]]")
        if r["doc"]:
            body.append(r["doc"])
        if r["sig"] and r["kind"] in ("table", "adr"):
            body.append(f"`{_short(r['sig'], 400)}`")
        if r["kind"] in FILE_KINDS:
            syms = g.q("select name, kind, start from nodes where file=? and kind in ('function','component','class','interface','type','enum','const') and exported=1 order by start", r["id"])
            if syms:
                body.append("## Exports\n" + "\n".join(f"- {s['kind']} `{s['name']}` :{s['start']}" for s in syms[:60]))
        for rel, targets in sorted(links[r["id"]].items()):
            body.append(f"## {rel.lower().replace('_', ' ')}\n" + "\n".join(f"- [[{names[t]}]]" for t in sorted(targets, key=lambda t: names[t])))
        (vault / f"{names[r['id']]}.md").write_text("\n\n".join(x for x in body if x) + "\n")
        written += 1
    for i, a in areas.items():
        members = [names[r["id"]] for r in rows if r["area"] == i and r["id"] in names]
        (vault / f"{area_note[i]}.md").write_text(f"---\ntags: [kind/area, area/{i:02d}]\n---\n\n# #{i} {a['name']}\n\n{a['summary']}\n\n## Files\n" + "\n".join(f"- [[{m}]]" for m in sorted(members)) + "\n")
    (vault / "README.md").write_text(
        "# Open Media graph vault (generated)\n\nGenerated by `kg.py export obsidian` from `.knowledge/graph.sqlite`. Do not edit: the next export overwrites these notes.\n\n"
        "- `code/`: one note per source file (path with › for /), linked by imports, calls, renders, type use, references and tests.\n"
        "- `tables/`: database tables with foreign keys and the code using them.\n- `adrs/`: decisions, linked to the code they name and the code citing them.\n"
        "- `areas/`: communities of the code graph; graph colours follow the `area/NN` tags.\n")
    # Graph view colours: one group per area, keep the user's other settings.
    obs = vault / ".obsidian"
    obs.mkdir(exist_ok=True)
    gpath = obs / "graph.json"
    try:
        cfg = json.loads(gpath.read_text())
    except (OSError, ValueError):
        cfg = {"showOrphans": False, "repelStrength": 12, "linkDistance": 120, "showArrow": True}
    import colorsys
    groups = []
    for n, i in enumerate(sorted(areas)):
        r_, g_, b_ = colorsys.hls_to_rgb(((n * 137.5) % 360) / 360, 0.5, 0.6)
        groups.append({"query": f"tag:#area/{i:02d}", "color": {"a": 1, "rgb": (int(r_ * 255) << 16) + (int(g_ * 255) << 8) + int(b_ * 255)}})
    groups += [{"query": "tag:#kind/table", "color": {"a": 1, "rgb": 0xD98B19}}, {"query": "tag:#kind/adr", "color": {"a": 1, "rgb": 0x8E5BD6}}]
    cfg["colorGroups"] = groups
    gpath.write_text(json.dumps(cfg, indent=2))
    print(f"{vault.relative_to(build.ROOT)}: {written} notes + {len(areas)} area notes. In Obsidian: Open folder as vault → this folder, then Graph view.")
    return vault


def export_graphml(g) -> Path:
    import networkx as nx
    G = nx.DiGraph()
    for r in g.q("select * from nodes where kind not in ('section','test','package')"):
        G.add_node(r["id"], label=r["name"], kind=r["kind"], area=r["area"] or 0, file=r["file"] or "", rank=float(r["rank"] or 0))
    for e in g.q("select src, dst, rel from edges"):
        if e["src"] in G and e["dst"] in G and e["rel"] not in SKIP_RELS:
            G.add_edge(e["src"], e["dst"], rel=e["rel"])
    out = OUT / "graph.graphml"
    nx.write_graphml(G, out)
    print(f"{out.relative_to(build.ROOT)}: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges (open in Gephi; colour by 'area' or 'kind')")
    return out
