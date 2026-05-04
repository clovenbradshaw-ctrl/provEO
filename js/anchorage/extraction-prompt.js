/* ===========================================================================
   ANCHORAGE — extraction prompt scaffold
   ---------------------------------------------------------------------------
   Modified eoreader prompt. Per the spec:

     "Stage 1 — Extraction. Modified eoreader prompt emits four-tuple
      (G, F, P, phasepost) per clause. One observation event per clause.
      Agent: anchorage:extract:vN."

   This module owns the prompt template plus a small helper that turns a
   model response into observation event partials ready for EOFormat.makeEvent.

   The substrate ships the prompt; the regression run (item 2 of First task —
   "regression run on existing 19k corpus") happens in a deployment harness
   that:
     1. Iterates the corpus,
     2. Calls the extractor with this prompt against each clause,
     3. Emits observation events,
     4. Folds and compares cell distributions to v2 baseline.

   The harness is not in this commit. The plug point is documented at the
   bottom of this file: pass each clause through `buildExtractionMessages`,
   parse the model output with `parseExtractionResponse`, and pipe the
   resulting partials through `EOFormat.makeEvent`.

   Public surface:
     AnchorageExtraction.PROMPT_VERSION
     AnchorageExtraction.SYSTEM_PROMPT
     AnchorageExtraction.buildExtractionMessages(clause, ctx)
     AnchorageExtraction.parseExtractionResponse(text)
     AnchorageExtraction.PHASEPOST_DOMAIN  — frozen domain values (Ground row first)
     AnchorageExtraction.PHASEPOST_OBJECT  — frozen object values
============================================================================ */

(function (global) {
  'use strict';

  const PROMPT_VERSION = 'anchorage:extract:v1';

  // The phasepost address space — the EO native cell addressing scheme.
  // Mode is which phase (sig/ins/con/def/eva/nul) the clause is in.
  // Domain is the row of the matrix; object is the column.
  // Order matters: Ground row first so unfilled rows produce visible
  // sparsity in the cell-population fold output.
  const PHASEPOST_MODE = Object.freeze(['sig', 'ins', 'con', 'def', 'eva', 'nul']);
  const PHASEPOST_DOMAIN = Object.freeze(['ground', 'figure', 'significance']);
  const PHASEPOST_OBJECT = Object.freeze(['entity', 'event', 'attribute', 'relation', 'state']);

  const SYSTEM_PROMPT = `You are an EO clause extractor. Your only job is to read one clause at
a time and emit a four-tuple (G, F, P, phasepost) describing it.

G — Ground: what is given, observed, or factually present in the clause.
    A short paraphrase, in plain language, of the empirical content.
F — Figure: the named entity, event, or attribute the clause is about.
    Use a noun phrase. Coreference is fine; the anchoring stage handles
    canonicalization.
P — Significance: what makes this clause matter for downstream reasoning.
    A brief justification in plain language. Often empty for simple
    factual clauses; populate when context warrants.

phasepost is a three-tuple [mode, domain, object] addressing the cell
the clause occupies in the EO matrix:

  mode    ∈ {sig, ins, con, def, eva, nul}
          sig — recognize signal (pattern hit in source)
          ins — mint anchor (entity / value identity established)
          con — link to graph (cross-source edges)
          def — establish term (assignment of value)
          eva — evaluate against definitions (confirm / conflict)
          nul — record absence (expected pattern not found)
  domain  ∈ {ground, figure, significance}
  object  ∈ {entity, event, attribute, relation, state}

Output STRICT JSON, exactly the shape:

  {"G":"...","F":"...","P":"...","phasepost":["mode","domain","object"]}

No prose, no explanation, no markdown fence. If you cannot extract the
tuple, emit {"G":"","F":"","P":"","phasepost":["nul","ground","entity"]}.`;

  // Build the chat-completions message list for one clause.
  // ctx may carry { src, doc_title, prior_clause, next_clause } for context.
  function buildExtractionMessages(clause, ctx) {
    const c = ctx || {};
    const userPayload = {
      clause: clause || '',
      context: {
        src: c.src || null,
        doc_title: c.doc_title || null,
        prior_clause: c.prior_clause || null,
        next_clause: c.next_clause || null
      }
    };
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(userPayload) }
    ];
  }

  // Parse a model response into a partial observation event ready for
  // EOFormat.makeEvent. Returns { ok, partial, reason }.
  function parseExtractionResponse(text) {
    if (typeof text !== 'string') {
      return { ok: false, reason: 'response not a string' };
    }
    // Strip code fences if a model insists on them despite instructions.
    const cleaned = text.trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '');
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch (e) { return { ok: false, reason: 'parse error: ' + e.message }; }
    if (!parsed || typeof parsed !== 'object') {
      return { ok: false, reason: 'response not an object' };
    }
    const G = typeof parsed.G === 'string' ? parsed.G : '';
    const F = typeof parsed.F === 'string' ? parsed.F : '';
    const P = typeof parsed.P === 'string' ? parsed.P : '';
    const pp = parsed.phasepost;
    if (!Array.isArray(pp) || pp.length !== 3) {
      return { ok: false, reason: 'phasepost must be [mode,domain,object]' };
    }
    const [mode, domain, object] = pp;
    if (!PHASEPOST_MODE.includes(mode)) {
      return { ok: false, reason: 'unknown mode: ' + mode };
    }
    if (!PHASEPOST_DOMAIN.includes(domain)) {
      return { ok: false, reason: 'unknown domain: ' + domain };
    }
    if (!PHASEPOST_OBJECT.includes(object)) {
      return { ok: false, reason: 'unknown object: ' + object };
    }
    return { ok: true, partial: { G, F, P, phasepost: [mode, domain, object] } };
  }

  global.AnchorageExtraction = {
    PROMPT_VERSION,
    SYSTEM_PROMPT,
    PHASEPOST_MODE,
    PHASEPOST_DOMAIN,
    PHASEPOST_OBJECT,
    buildExtractionMessages,
    parseExtractionResponse
  };

  // -------------------------------------------------------------
  // Regression-run plug point (item 2 of First task).
  //
  // The harness is intentionally not committed here — it depends on
  // corpus access and a v2 baseline cell-distribution snapshot, neither
  // of which are part of the substrate. Pseudocode for the harness:
  //
  //   for clause of corpus:
  //     msgs = buildExtractionMessages(clause.text, clause.ctx)
  //     resp = await callModel(msgs)                   // local LLM call
  //     r = parseExtractionResponse(resp)
  //     if (!r.ok) { recordFailure(clause, r.reason); continue }
  //     evt = await EOFormat.makeEvent({
  //       type: 'observation',
  //       src: clause.src,                              // 'doc:N:cl:M'
  //       clause: clause.text,
  //       phasepost: r.partial.phasepost,
  //       G: r.partial.G, F: r.partial.F, P: r.partial.P,
  //       agent: AnchorageExtraction.PROMPT_VERSION
  //     })
  //     await appendEoEvent(evt)
  //
  //   then:
  //     projection = AnchorageFold.fold(events, builtinHorizons.latest)
  //     compareCellDistributions(projection.cellPopulations, v2_baseline)
  //
  // The cell-distribution delta is what stage 1 gates on before
  // proceeding to fold engine work.
  // -------------------------------------------------------------
})(typeof window !== 'undefined' ? window : globalThis);
