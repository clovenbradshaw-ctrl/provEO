/* Anchorage smoke test — Node-runnable. Verifies:
   1. round-trip (events → serialize → parse → equal)
   2. content-hash determinism (same body → same id)
   3. fold under σ=latest projects most-recent operand
   4. fold under σ=comparative returns full live stacks
   5. supersession buckets correctly by operand-key
   6. lens DEFs in different frameworks coexist (no false contradiction)

   Usage: node js/anchorage/_smoke-test.js
*/

'use strict';

const assert = require('assert');
const { webcrypto } = require('crypto');

// Polyfill the browser globals these classic-script modules attach to.
// Node 22 already exposes `crypto` as a getter on globalThis, so the
// modules' `global.crypto` lookups resolve to webcrypto without us
// re-assigning it. We only need a `window` proxy with the same crypto.
const fakeWindow = { crypto: globalThis.crypto || webcrypto };
global.window = fakeWindow;
if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// Load order matches the index.html script tags.
require('./eo-format.js');
require('./fold.js');
require('./extraction-prompt.js');

const EOFormat = fakeWindow.EOFormat;
const AnchorageFold = fakeWindow.AnchorageFold;
const AnchorageExtraction = fakeWindow.AnchorageExtraction;

(async function run() {
  // 1. Build a small log.
  const obs = await EOFormat.makeEvent({
    type: 'observation', src: 'doc:1:cl:1', clause: 'A clause.',
    phasepost: ['ins', 'particular', 'existence'],
    G: 'a', F: 'a', P: '',
    ts: '2024-01-01T00:00:00Z', agent: 'anchorage:extract:v1'
  });
  const anc = await EOFormat.makeEvent({
    type: 'anchor', aid: 'ent:foo', first_seen: 'doc:1:cl:1',
    ts: '2024-01-01T00:00:01Z', agent: 'anchorage:anchor:v1'
  });
  const def_old = await EOFormat.makeEvent({
    type: 'def', target: 'ent:foo', kind: 'property',
    operand: { property_type: 'name', value: 'OldName' },
    cursors: { valid_from: '2024-01-01T00:00:00Z', asserted_at: '2024-01-01T00:00:02Z' },
    ts: '2024-01-01T00:00:02Z', agent: 'anchorage:extract:v1'
  });
  const def_new = await EOFormat.makeEvent({
    type: 'def', target: 'ent:foo', kind: 'property',
    operand: { property_type: 'name', value: 'NewName' },
    cursors: { valid_from: '2024-06-01T00:00:00Z', asserted_at: '2024-06-01T00:00:00Z' },
    ts: '2024-06-01T00:00:00Z', agent: 'human:reporter'
  });
  const def_lens_bfo = await EOFormat.makeEvent({
    type: 'def', target: 'ent:foo', kind: 'lens',
    operand: { framework: 'bfo', category: 'IndependentContinuant' },
    cursors: { valid_from: '2024-06-01T00:00:00Z', asserted_at: '2024-06-01T00:01:00Z' },
    ts: '2024-06-01T00:01:00Z', agent: 'human:reporter'
  });
  const def_lens_dolce = await EOFormat.makeEvent({
    type: 'def', target: 'ent:foo', kind: 'lens',
    operand: { framework: 'dolce', category: 'PhysicalEndurant' },
    cursors: { valid_from: '2024-06-01T00:00:00Z', asserted_at: '2024-06-01T00:02:00Z' },
    ts: '2024-06-01T00:02:00Z', agent: 'human:reporter'
  });
  const events = [obs, anc, def_old, def_new, def_lens_bfo, def_lens_dolce];

  // 2. Round-trip.
  const serialized = EOFormat.serializeEoFile(events);
  const parsed = EOFormat.parseEoFile(serialized);
  assert.strictEqual(parsed.errors.length, 0, 'no parse errors');
  assert.strictEqual(parsed.events.length, events.length, 'all events round-tripped');
  for (let i = 0; i < events.length; i++) {
    assert.strictEqual(parsed.events[i].id, events[i].id, 'id matches at index ' + i);
  }

  // 3. Content-hash determinism.
  const same = await EOFormat.makeEvent({
    type: 'def', target: 'ent:foo', kind: 'property',
    operand: { property_type: 'name', value: 'NewName' },
    cursors: { valid_from: '2024-06-01T00:00:00Z', asserted_at: '2024-06-01T00:00:00Z' },
    ts: '2024-06-01T00:00:00Z', agent: 'human:reporter'
  });
  assert.strictEqual(same.id, def_new.id, 'identical body → identical id');

  // 4. σ=latest projects most-recent operand for property.
  const projLatest = AnchorageFold.fold(events, AnchorageFold.builtinHorizons.latest);
  const propBucket = projLatest.projections['ent:foo'].property.buckets['property:name'];
  assert.strictEqual(propBucket.winner.id, def_new.id, 'latest σ picks the newer property DEF');

  // 5. σ=comparative returns full stacks, no winner.
  const projComp = AnchorageFold.fold(events, AnchorageFold.builtinHorizons.comparative);
  const propBucketComp = projComp.projections['ent:foo'].property.buckets['property:name'];
  assert.strictEqual(propBucketComp.winner, null, 'comparative σ has no winner');
  assert.strictEqual(propBucketComp.stack.length, 2, 'comparative stack contains both DEFs');

  // 6. Lens DEFs in different frameworks DO NOT trigger contradiction.
  const lensProj = projLatest.projections['ent:foo'].lens;
  assert.ok(lensProj.buckets['lens:bfo'], 'BFO lens bucket exists');
  assert.ok(lensProj.buckets['lens:dolce'], 'DOLCE lens bucket exists');
  const lensContradictions = projLatest.contradictions.filter(c => c.kind === 'lens');
  assert.strictEqual(lensContradictions.length, 0, 'different frameworks do not contradict');

  // 7. Cell populations bucket per anchor.
  const cells = projLatest.cellPopulations['ent:foo'];
  assert.strictEqual(cells['[ins,particular,existence]'], 1, 'cell pop matches the single observation');
  assert.strictEqual(Object.keys(cells).length, 1, 'only one cell populated');

  // 8. Extraction prompt parser handles strict and fenced output.
  const r1 = AnchorageExtraction.parseExtractionResponse(
    '{"G":"x","F":"y","P":"z","phasepost":["ins","particular","existence"]}'
  );
  assert.ok(r1.ok, 'strict JSON parses');
  const r2 = AnchorageExtraction.parseExtractionResponse(
    '```json\n{"G":"x","F":"y","P":"z","phasepost":["ins","particular","existence"]}\n```'
  );
  assert.ok(r2.ok, 'fenced JSON parses');
  const r3 = AnchorageExtraction.parseExtractionResponse(
    '{"G":"","F":"","P":"","phasepost":["zzz","particular","existence"]}'
  );
  assert.strictEqual(r3.ok, false, 'unknown mode rejected');

  // 9. Validation rejects malformed events.
  const v1 = EOFormat.validateEvent({ id: 'sha256:abc', type: 'def' });
  assert.strictEqual(v1.valid, false, 'malformed def rejected');

  // 10. Two DEFs in different operand-buckets (different property types)
  //     do NOT contradict each other under σ=latest.
  const def_size = await EOFormat.makeEvent({
    type: 'def', target: 'ent:foo', kind: 'property',
    operand: { property_type: 'employee_count', value: 50 },
    cursors: { valid_from: '2024-06-01T00:00:00Z', asserted_at: '2024-06-01T00:03:00Z' },
    ts: '2024-06-01T00:03:00Z', agent: 'human:reporter'
  });
  const projB = AnchorageFold.fold(events.concat(def_size), AnchorageFold.builtinHorizons.latest);
  const propContradictions = projB.contradictions.filter(c => c.kind === 'property');
  assert.strictEqual(propContradictions.length, 0, 'different property types do not contradict');

  console.log('OK — all smoke checks passed.');
})().catch(err => {
  console.error('FAIL:', err);
  process.exitCode = 1;
});
