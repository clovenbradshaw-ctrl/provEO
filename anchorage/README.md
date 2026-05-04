# Anchorage

Phasepost-addressed observation logs with editable definitions and pluggable upper-ontology renderers. One product, two modes: **Writing** (citations, drafting, the existing proveo flow) and **Reading** (clause-level extraction with cursor-aware definitions, the eoreader flow). Both modes share the same `.eodb` substrate.

## Entry points

- **Anchorage shell:** `anchorage.html` — the unified entry. Hosts whichever mode is active in an iframe and provides the cross-mode toggle. Mode and cursor are reflected in the URL hash, so deep links and browser back/forward work.
- **Writing only:** `index.html` — the existing proveo app, untouched. Hit it directly and the runtime nav (`anchorage/integration/nav.js`) injects a top-right toggle that takes you to the shell.
- **Reading only:** `read.html` — a thin shim that frames the eoreader Pages deployment and bridges `anchorage:*` postMessages between shell and reader. Stage 3 will inline the reader source so the eoreader repo can be retired.

## Cross-mode citation flow

The shell owns a small message bus (`anchorage/integration/citation-bridge.js`). Inner apps speak four messages:

| direction         | kind     | payload         | trigger                                 |
|-------------------|----------|-----------------|------------------------------------------|
| inner -> shell    | `ready`  | `{ mode }`      | inner module finished booting            |
| inner -> shell    | `jump`   | `{ mode, cursor }` | user clicks something tagged for jump |
| inner -> shell    | `cite`   | `{ cursor }`    | user clicks "Cite this" in reading      |
| shell -> inner    | `cursor` | `{ cursor }`    | mode switched or deep link landed       |
| shell -> inner    | `cite`   | `{ cursor }`    | forward cite to writing for insertion   |

Cursors are objects like `{ src: 'doc:1:cl:42', anchor: 'ent:river-truckee' }`. The shell encodes them into the URL fragment when switching modes so the receiving inner page can scroll/highlight on load.

### Wiring (Stage 2 — done, infrastructure)

The shell auto-injects an inner module into the iframe at load time:

- Writing mode → `anchorage/integration/inner-writing.js`
- Reading mode → `anchorage/integration/inner-reading.js` (injected by `read.html` into its eoreader child)

Neither inner module requires changes to the host monolith to function safely — they no-op when the host hasn't opted in. They become useful as the host opts in via either:

1. Existing proveo conventions (`.cite-badge a`, `.fn-source a`, `.footnotes-list li`) — already wired
2. Explicit data attributes:
   - `data-anchorage-jump` (clickable jump target)
   - `data-anchorage-cite` (clickable cite target)
   - `data-anchorage-src="doc:1:cl:42"`
   - `data-anchorage-anchor="ent:river-truckee"`
3. Custom event listener for cite insertion:

   ```js
   document.addEventListener('anchorage:cite', e => {
     editor.insertCitationAtCaret(e.detail);   // { src, anchor, ... }
   });
   ```

## Layout

```
anchorage.html                  — unified shell with mode toggle + bridge
read.html                       — reading mode entry (Stage 1: iframe + passthrough)
index.html                      — writing mode entry (proveo, untouched)

anchorage/
  SPEC.md                       — wire format v1 (locked)
  README.md                     — this file
  wire/                         — .eodb canonical encoding, schema, importer, σ DSL
  extract/                      — anchorage:extract:v3 prompt + regression
  integration/
    nav.js                      — standalone-page nav injector
    citation-bridge.js          — shell <-> inner-app message protocol + URL hash codec
    inner-writing.js            — wires proveo writing app to bridge (auto + opt-in)
    inner-reading.js            — wires reading app to bridge (auto + opt-in)
  test/                         — round-trip + regression tests
```

## Stage plan

- **Stage 1 (done):** shell + read.html + nav + bridge contract.
- **Stage 2 (done, this commit):** inner modules auto-injected into iframes; writing app wired to existing `.cite-badge` / `.footnotes-list` conventions; reading app wired via opt-in data attributes + hover "Cite" affordance for cursor-bearing elements.
- **Stage 3:** physically inline the reader source as proveo modules (modularize the eoreader monolith); retire the eoreader Pages deployment; `read.html` serves the inlined reader directly. This also lets the writing app emit `data-anchorage-src` / `data-anchorage-anchor` on its own citations (instead of relying on heuristic resolution from `.fn-loc` text).

## Run tests

```
node anchorage/test/round-trip.test.mjs
node anchorage/test/regression.test.mjs
```

Browser: serve the repo root and open `anchorage/test/run.html`.
