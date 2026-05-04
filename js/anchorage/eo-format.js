/* ===========================================================================
   ANCHORAGE — .eo file format
   ---------------------------------------------------------------------------
   JSONL, append-only, content-hashed event IDs (sha256). Five event types —
   observation, anchor, def, rec, horizon. Nothing else.

   Architectural commitment: the Given-Log is the only persistent state. This
   module owns the bytes; the fold module owns interpretation. Nothing here
   stores supersession, current values, edges, or classifications — those are
   fold outputs.

   Public surface:
     EOFormat.EVENT_TYPES                 — frozen tuple of valid `type` values
     EOFormat.DEF_KINDS                   — frozen tuple of valid def `kind`s
     EOFormat.computeEventId(eventBody)   — async, returns 'sha256:<hex>'
     EOFormat.makeEvent(partial)          — async, fills id+ts, validates
     EOFormat.parseEoFile(text)           — { events, errors, lineCount }
     EOFormat.serializeEoFile(events)     — JSONL string
     EOFormat.validateEvent(evt)          — { valid, reason }
     EOFormat.canonicalizeForHash(obj)    — deterministic JSON for hashing
============================================================================ */

(function (global) {
  'use strict';

  const EVENT_TYPES = Object.freeze([
    'observation', 'anchor', 'def', 'rec', 'horizon'
  ]);

  // Five DEF kinds — the spec is explicit: no more without strong justification.
  // 'lens' carries arbitrary projection operands; the substrate does not validate
  // their inner structure (that's the Lens convention's responsibility).
  const DEF_KINDS = Object.freeze([
    'classification', 'property', 'relation', 'scope', 'lens'
  ]);

  // ---------------------------------------------------------------
  // Canonical JSON for content hashing.
  //
  // Deterministic — keys sorted lexicographically at every level, no
  // whitespace, NaN/Infinity rejected. The id field is excluded by the
  // caller before hashing (computing an id over itself is nonsense).
  // ---------------------------------------------------------------
  function canonicalizeForHash(value) {
    if (value === null) return 'null';
    if (typeof value === 'boolean') return value ? 'true' : 'false';
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error('canonicalizeForHash: non-finite number');
      }
      // JSON.stringify handles -0 → "0", which matches our hashing intent.
      return JSON.stringify(value);
    }
    if (typeof value === 'string') return JSON.stringify(value);
    if (Array.isArray(value)) {
      return '[' + value.map(canonicalizeForHash).join(',') + ']';
    }
    if (typeof value === 'object') {
      const keys = Object.keys(value).sort();
      const parts = [];
      for (const k of keys) {
        const v = value[k];
        if (v === undefined) continue; // mirrors JSON.stringify semantics
        parts.push(JSON.stringify(k) + ':' + canonicalizeForHash(v));
      }
      return '{' + parts.join(',') + '}';
    }
    throw new Error('canonicalizeForHash: unsupported type ' + typeof value);
  }

  // Web Crypto sha256 → 'sha256:<lowercase hex>'.
  async function computeEventId(eventBodyWithoutId) {
    const enc = new TextEncoder();
    const bytes = enc.encode(canonicalizeForHash(eventBodyWithoutId));
    if (!global.crypto || !global.crypto.subtle) {
      throw new Error('computeEventId: crypto.subtle unavailable');
    }
    const hash = await global.crypto.subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0')).join('');
    return 'sha256:' + hex;
  }

  // ---------------------------------------------------------------
  // Minimal structural validation.
  //
  // The substrate is deliberately permissive about operand shapes — Lens
  // DEFs in particular carry arbitrary framework-specific structure, and
  // the spec wants three different BFO conventions to coexist without
  // arbitration. Validation here covers only what the fold needs to fold:
  // the type tag, the required fields per type, and cursor shape on
  // DEF/REC events.
  // ---------------------------------------------------------------
  function validateEvent(evt) {
    if (!evt || typeof evt !== 'object') {
      return { valid: false, reason: 'not an object' };
    }
    if (typeof evt.id !== 'string' || !evt.id.startsWith('sha256:')) {
      return { valid: false, reason: 'missing or malformed id' };
    }
    if (!EVENT_TYPES.includes(evt.type)) {
      return { valid: false, reason: 'unknown type: ' + evt.type };
    }
    if (typeof evt.ts !== 'string' || !evt.ts) {
      return { valid: false, reason: 'missing ts' };
    }
    if (typeof evt.agent !== 'string' || !evt.agent) {
      return { valid: false, reason: 'missing agent' };
    }
    switch (evt.type) {
      case 'observation':
        if (typeof evt.src !== 'string')        return { valid: false, reason: 'observation missing src' };
        if (typeof evt.clause !== 'string')     return { valid: false, reason: 'observation missing clause' };
        if (!Array.isArray(evt.phasepost) || evt.phasepost.length !== 3) {
          return { valid: false, reason: 'observation phasepost must be [mode,domain,object]' };
        }
        return { valid: true };
      case 'anchor':
        if (typeof evt.aid !== 'string' || !evt.aid) {
          return { valid: false, reason: 'anchor missing aid' };
        }
        return { valid: true };
      case 'def':
        if (typeof evt.target !== 'string' || !evt.target) {
          return { valid: false, reason: 'def missing target' };
        }
        if (!DEF_KINDS.includes(evt.kind)) {
          return { valid: false, reason: 'def unknown kind: ' + evt.kind };
        }
        if (!evt.operand || typeof evt.operand !== 'object') {
          return { valid: false, reason: 'def missing operand' };
        }
        return validateCursors(evt.cursors);
      case 'rec':
        if (typeof evt.target !== 'string' || !evt.target) {
          return { valid: false, reason: 'rec missing target' };
        }
        if (!evt.frame_change || typeof evt.frame_change !== 'object') {
          return { valid: false, reason: 'rec missing frame_change' };
        }
        return validateCursors(evt.cursors);
      case 'horizon':
        if (typeof evt.name !== 'string' || !evt.name) {
          return { valid: false, reason: 'horizon missing name' };
        }
        if (!evt.sigma || typeof evt.sigma !== 'object') {
          return { valid: false, reason: 'horizon missing sigma' };
        }
        return { valid: true };
    }
    return { valid: false, reason: 'unreachable' };
  }

  function validateCursors(cursors) {
    if (!cursors || typeof cursors !== 'object') {
      return { valid: false, reason: 'missing cursors' };
    }
    // valid_from is the only strictly-required cursor on the fold path —
    // the others gain meaning under specific σ choices and are checked
    // lazily by the fold when projecting against them.
    if (typeof cursors.valid_from !== 'string') {
      return { valid: false, reason: 'cursors.valid_from required' };
    }
    return { valid: true };
  }

  // ---------------------------------------------------------------
  // Event factory.
  //
  // Caller supplies everything except `id` (and optionally `ts`). The
  // factory fills `ts` with the current ISO instant if missing, then
  // computes a content-addressed id over the canonical body. The same
  // event body produced twice yields the same id — that's the point.
  // ---------------------------------------------------------------
  async function makeEvent(partial) {
    if (!partial || typeof partial !== 'object') {
      throw new Error('makeEvent: partial must be an object');
    }
    const body = { ...partial };
    delete body.id;
    if (!body.ts) body.ts = new Date().toISOString();
    const id = await computeEventId(body);
    const evt = { id, ...body };
    const v = validateEvent(evt);
    if (!v.valid) throw new Error('makeEvent: ' + v.reason);
    return evt;
  }

  // ---------------------------------------------------------------
  // File round-trip.
  //
  // Parse is forgiving on individual lines — bad lines are reported,
  // the rest pass through. Empty lines are skipped silently (so a
  // trailing newline doesn't produce a phantom error). Round-trip is
  // guaranteed only for valid events; malformed lines are dropped on
  // re-serialize.
  // ---------------------------------------------------------------
  function parseEoFile(text) {
    const events = [];
    const errors = [];
    const lines = (text || '').split('\n');
    let lineCount = 0;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw || !raw.trim()) continue;
      lineCount++;
      let evt;
      try { evt = JSON.parse(raw); }
      catch (e) {
        errors.push({ line: i + 1, reason: 'parse error: ' + e.message });
        continue;
      }
      const v = validateEvent(evt);
      if (!v.valid) {
        errors.push({ line: i + 1, reason: v.reason });
        continue;
      }
      events.push(evt);
    }
    return { events, errors, lineCount };
  }

  function serializeEoFile(events) {
    const out = [];
    for (const e of events || []) {
      const v = validateEvent(e);
      if (!v.valid) continue;
      out.push(JSON.stringify(e));
    }
    // Trailing newline so concatenation of two .eo files is itself valid.
    return out.length ? out.join('\n') + '\n' : '';
  }

  global.EOFormat = {
    EVENT_TYPES,
    DEF_KINDS,
    canonicalizeForHash,
    computeEventId,
    validateEvent,
    makeEvent,
    parseEoFile,
    serializeEoFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
