# Knowledge graph

A local, deterministic graph of the Open Media code, database and decisions. Agents query it instead of grepping and reading whole files: a typical answer costs 100–300 tokens and about 0.1 s.

## What is in it

| Layer | Source | Nodes | Edges |
|---|---|---|---|
| Code | `extract.ts` (TypeScript type checker) | file, function, component, class, method, interface, type, enum, const, test case, Worker route | CALLS, RENDERS, IMPORTS, USES_TYPE, EXTENDS, IMPLEMENTS, TESTS, HANDLES, USES_PACKAGE |
| Data | `supabase/migrations`, `services/mail-sync/migrations` | table (columns, RLS policy names), SQL function, migration | REFERENCES (foreign keys), DEFINES, ALTERS, USES_TABLE, CALLS_RPC (from code and SQL functions) |
| Docs | every tracked `.md` except generated skills | ADR, doc, section | MENTIONS (files, symbols, tables, ADRs named in a section), CITES ("ADR nnnn" in code comments) |
| Areas | Louvain communities over the file graph | area with an extractive summary card | |
| Search | SQLite FTS5 (BM25, porter stemming, camelCase split) | names, signatures, doc comments, section text | |

No LLM, embedding or network calls. Edges come from the compiler, so they are exact rather than guessed, with these limits: dynamic calls (callbacks passed as values, `obj[key]()`) and string-built table names are not seen, and routes are detected from `pathname === '/x'` and `pathname.startsWith('/x')` comparisons only.

## Use

```sh
npm run kg -- overview                 # repo map: areas, central symbols, ADRs (start here)
npm run kg -- search read receipts     # BM25 over symbols, tables, routes, tests, doc sections
npm run kg -- sym PostCard             # signature, doc, callers, callees, data, tests, docs
npm run kg -- body maxLivePlayers      # just the source lines of a symbol or doc section
npm run kg -- file src/ui/usePlayback.ts
npm run kg -- impact src/domain/mediaPlayback.ts   # dependents by file + tests to run
npm run kg -- path OpenMediaFeed message_reactions # how two things connect
npm run kg -- table conversations      # columns, FKs, migrations, SQL functions, code users
npm run kg -- route /v1/me             # Worker routes and handlers
npm run kg -- adr 38                   # decision, the code it names, code citing it
npm run kg -- area 12                  # one architecture area's summary card
```

Or call `python3 scripts/knowledge-graph/kg.py …` directly (it skips npm's startup time).

## Freshness

The graph lives in `.knowledge/` (gitignored): `graph.sqlite` and `OVERVIEW.md`. `kg.py` fingerprints the tracked and untracked `.ts`, `.tsx`, `.sql` and `.md` files and rebuilds the graph by itself when any of them changed (about 9 s). Pass `--no-refresh` to skip that. Force a rebuild with `npm run kg:build`.

## Files

- `extract.ts`: code layer, JSON lines on stdout (run with `node --import tsx`).
- `build.py`: runs the extractor, parses SQL and Markdown, computes PageRank and Louvain areas (needs `networkx`), writes SQLite.
- `kg.py`: the query CLI.

## Notes for agents

- Use the graph to find things and judge impact, then read only the lines you need (`kg body`, or Read with an offset). Use the TypeScript LSP when you need exact references after an edit.
- Area names and summaries are generated from file names, doc comments and edges, so treat them as a map, not as documentation.
- Never commit `.knowledge/`. It holds no secrets, but it's derived output.
