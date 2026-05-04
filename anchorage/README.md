# Anchorage

Phasepost-addressed observation logs with editable definitions and pluggable upper-ontology renderers. One product, two modes: **Writing** (citations, drafting, the existing proveo flow) and **Reading** (clause-level extraction with cursor-aware definitions, the eoreader flow). Both modes share the same `.eodb` substrate.

## Entry points

- **Anchorage shell:** `anchorage.html` — the unified entry. Hosts whichever mode is active in an iframe and provides the cross-mode toggle. Mode and cursor are reflected in the URL hash, so deep links and browser back/forward work.
- **Writing only:** `index.html` — the existing proveo app, untouched. The runtime nav injector (`anchorage/integration/nav.js`) adds a top-right toggle that takes you to the shell.
- **Reading only:** `read.html` — a thin shim that frames the eoreader Pages deployment. Stage 2 will inline the reader source so the eoreader repo can be retired.

## Cross-mode citation flow

The shell owns a small message bus (`anchorage/integration/citation-bridge.js`). Inner apps speak two messages:

- `jump` — "open this cursor in the other mode"
- `cite` — "insert a citation at the writing-mode caret"

Cursors are objects like `{ src: 'doc:1:cl:42', anchor: 'ent:river-truckee' }`. The shell encodes them into the URL fragment when switching modes so the receiving inner page can scroll/highlight on load.

Inner apps integrate by importing `Inner` from the bridge:

```js
import { Inner } from './anchorage/integration/citation-bridge.js';

// once the app has rendered:
Inner.ready('writing');           // tell the shell we're up

// on a citation click:
Inner.jump('reading', { src: 'doc:1:cl:42', anchor: 'ent:river-truckee' });

// in the writing app, listen for citations sent from reading:
Inner.onCite(cursor => editor.insertCitation(cursor));

// in the reading app, on "Cite this" button:
Inner.cite({ src: 'doc:1:cl:42', anchor: 'ent:river-truckee' });
```

Wiring the existing apps to call these is Stage 2 work. The bridge module is the contract; both apps can adopt it incrementally without touching each other.

## Layout

```
anchorage.html                  — unified shell with mode toggle
read.html                       — reading mode entry (Stage 1: iframe)
index.html                      — writing mode entry (proveo, untouched)

anchorage/
  SPEC.md                       — wire format v1 (locked)
  README.md                     — this file
  wire/                         — .eodb canonical encoding, schema, importer, σ DSL
  extract/                      — anchorage:extract:v3 prompt + regression
  integration/
    nav.js                      — standalone-page nav injector
    citation-bridge.js          — shell <-> inner-app message protocol
  test/                         — round-trip + regression tests
```

## Stage plan

- **Stage 1 (this commit):** shell + read.html + nav + citation bridge contract. Both apps still work standalone; the shell unifies them at the deployment level. Eoreader repo continues to host its own Pages deployment, which read.html iframes.
- **Stage 2:** wire the existing writing app and the existing reading app to the citation bridge — click-to-jump on citations, "Cite this" button on clauses.
- **Stage 3:** physically inline the reader source as proveo modules (modularize the eoreader monolith); retire the eoreader Pages deployment; read.html serves the inlined reader directly.

## Run tests

```
node anchorage/test/round-trip.test.mjs
node anchorage/test/regression.test.mjs
```

Browser: serve the repo root and open `anchorage/test/run.html`.
