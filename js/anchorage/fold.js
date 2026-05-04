/* ===========================================================================
   ANCHORAGE — fold engine
   ---------------------------------------------------------------------------
   Given the full event log and a Horizon, the fold derives:

     - supersession (per (target, kind, operand-key))
     - current projected value at each anchor
     - cell populations and dominant addressing
     - contradictions (two live DEFs, no unifying supersession)
     - REC frame boundaries
     - anchor lifecycle (live within Horizon's temporal window)

   Nothing here is stored. Everything is recomputed on every fold pass.
   Switching σ is parameter substitution, not data migration.

   Public surface:
     AnchorageFold.fold(events, horizon)        — returns a projection bundle
     AnchorageFold.builtinHorizons              — { latest, comparative, ... }
     AnchorageFold.operandKey(kind, operand)    — supersession bucket key
     AnchorageFold.resolveSigma(stack, horizon, kind) — per-kind σ projection
============================================================================ */

(function (global) {
  'use strict';

  // ---------------------------------------------------------------
  // Horizons that ship with the substrate.
  //
  // - latest:        latest asserted_at wins per (anchor, kind, operand-key)
  // - comparative:   returns the full live stack instead of a single winner
  // - source_priority: agent reliability tier; weights are fold-derivable
  //                   and recomputed on every pass (no persistence).
  // - manual:        flags every (anchor, kind) for human resolution
  // - historical:    σ projects values as of an asserted_at cutoff
  // ---------------------------------------------------------------
  const builtinHorizons = Object.freeze({
    latest: {
      type: 'horizon',
      name: 'latest',
      sigma: { method: 'latest', cursor: 'asserted_at' }
    },
    comparative: {
      type: 'horizon',
      name: 'comparative',
      sigma: { method: 'comparative', cursor: 'asserted_at' }
    },
    manual: {
      type: 'horizon',
      name: 'manual',
      sigma: { method: 'manual', cursor: 'asserted_at' }
    }
  });

  // ---------------------------------------------------------------
  // Operand key — the bucket within which DEFs supersede each other.
  //
  // Two DEFs at the same target/kind with the same operand-key under most σ
  // choices contend; later replaces earlier. Different operand-keys coexist
  // (a thing can have many properties of different types).
  //
  // For 'lens' DEFs the bucket is per-framework so a BFO Lens and a DOLCE
  // Lens at the same anchor don't supersede each other — different lenses
  // are different views, not competing claims.
  // ---------------------------------------------------------------
  function operandKey(kind, operand) {
    const op = operand || {};
    switch (kind) {
      case 'classification':
        return 'classification';
      case 'property':
        return 'property:' + (op.property_type || op.type || op.name || 'unknown');
      case 'relation':
        return 'relation:' + (op.operator || 'unknown') + ':' +
               (Array.isArray(op.targets) ? op.targets.slice().sort().join('|') : '');
      case 'scope':
        return 'scope:' + (op.scope_type || op.kind || op.dimension || 'unknown');
      case 'lens':
        return 'lens:' + (op.framework || 'unknown');
      default:
        return kind + ':default';
    }
  }

  // ---------------------------------------------------------------
  // Cursor extraction.
  //
  // σ specifies which timestamp to compare against; we read it off the
  // event's `cursors` block, falling back to the event's `ts` if the
  // requested cursor is absent. valid_from is the safest fallback because
  // the spec requires it on every DEF/REC.
  // ---------------------------------------------------------------
  function readCursor(evt, cursorName) {
    const c = evt.cursors || {};
    return c[cursorName] || c.valid_from || c.asserted_at || evt.ts || '';
  }

  // ---------------------------------------------------------------
  // Per-kind σ override.
  //
  // Spec example horizon:
  //   "kinds": { "classification": "latest", "property": "agent_priority", ... }
  //
  // The kinds map overrides the top-level method per-kind. Falls back to
  // the top-level method when the kind isn't enumerated.
  // ---------------------------------------------------------------
  function effectiveMethod(horizon, kind) {
    const sig = (horizon && horizon.sigma) || {};
    if (sig.kinds && typeof sig.kinds === 'object' && sig.kinds[kind]) {
      return sig.kinds[kind];
    }
    return sig.method || 'latest';
  }

  // ---------------------------------------------------------------
  // Resolve a stack of DEFs (already grouped by operand-key) into a
  // projected winner — or, under `comparative`, the whole stack.
  //
  // Stack ordering: the caller passes events sorted ascending by the
  // active cursor. resolveSigma reads from the tail.
  // ---------------------------------------------------------------
  function resolveSigma(stack, horizon, kind) {
    if (!stack || !stack.length) return { winner: null, stack: [] };
    const method = effectiveMethod(horizon, kind);
    switch (method) {
      case 'latest': {
        return { winner: stack[stack.length - 1], stack };
      }
      case 'comparative': {
        // Return the full live stack — no winner. UI shows side-by-side.
        return { winner: null, stack, comparative: true };
      }
      case 'manual': {
        // Pending human resolution. UI surfaces a flag; no projection.
        return { winner: null, stack, pending_manual: true };
      }
      case 'agent_priority':
      case 'source_priority': {
        const sig = (horizon && horizon.sigma) || {};
        const weights = (sig.weights && typeof sig.weights === 'object') ? sig.weights : {};
        let best = null;
        let bestWeight = -Infinity;
        for (const evt of stack) {
          const w = weights[evt.agent] != null ? weights[evt.agent] : 0;
          // Tie-break on cursor (later cursor wins on equal weight).
          if (w > bestWeight ||
              (w === bestWeight && best &&
               readCursor(evt, sig.cursor || 'asserted_at') >
               readCursor(best, sig.cursor || 'asserted_at'))) {
            best = evt;
            bestWeight = w;
          }
        }
        return { winner: best, stack };
      }
      case 'historical': {
        const sig = (horizon && horizon.sigma) || {};
        const cutoff = sig.as_of || sig.cutoff || '';
        if (!cutoff) return { winner: stack[stack.length - 1], stack };
        const cursor = sig.cursor || 'asserted_at';
        let best = null;
        for (const evt of stack) {
          if (readCursor(evt, cursor) <= cutoff) best = evt;
        }
        return { winner: best, stack };
      }
      default:
        return { winner: stack[stack.length - 1], stack };
    }
  }

  // ---------------------------------------------------------------
  // The fold itself.
  //
  // Single pass over events. Builds:
  //   anchors[aid]                — { aid, first_seen, ts, observations: [...] }
  //   defStacks[aid][kind][opKey] — chronologically ordered DEF events
  //   recBoundaries[aid]          — REC events sorted by cursor (frame breaks)
  //   cellPopulations[aid]        — { cellAddrString -> count }
  //   horizonsInLog               — horizon events found in the file
  //
  // Then derives, per (anchor, kind), the σ-resolved projection plus a
  // contradiction flag whenever the σ method admits multiple live operand
  // buckets without resolution.
  // ---------------------------------------------------------------
  function fold(events, horizon) {
    const activeHorizon = horizon || builtinHorizons.latest;
    const sig = activeHorizon.sigma || {};
    const cursor = sig.cursor || 'asserted_at';

    const anchors = Object.create(null);
    const defStacks = Object.create(null);
    const recBoundaries = Object.create(null);
    const cellPopulations = Object.create(null);
    const horizonsInLog = [];
    const observationsByAnchor = Object.create(null);
    const observations = [];
    const allDefs = [];

    // Pass 1 — bin events by type. Order matters only within DEF stacks,
    // so we sort those at the end of the pass.
    for (const evt of events || []) {
      if (!evt || !evt.type) continue;
      switch (evt.type) {
        case 'horizon':
          horizonsInLog.push(evt);
          break;

        case 'anchor':
          anchors[evt.aid] = {
            aid: evt.aid,
            first_seen: evt.first_seen || null,
            ts: evt.ts,
            agent: evt.agent,
            event_id: evt.id
          };
          break;

        case 'observation': {
          observations.push(evt);
          // The spec stores src as 'doc:N:cl:M' — anchors aren't named on
          // observation events directly. Cell populations are addressed by
          // anchor only via the anchoring stage's downstream DEFs. We bucket
          // observations into a global pool plus an inferred per-anchor
          // pool when an anchor's first_seen matches the observation src.
          // This is intentionally light: rich anchor↔observation linkage is
          // a fold output, not a stored relation.
          const cell = Array.isArray(evt.phasepost)
            ? '[' + evt.phasepost.join(',') + ']'
            : '[unknown]';
          // Cell populations keyed by src so the addressing-by-anchor pass
          // below can attribute them when an anchor's first_seen lines up.
          (cellPopulations.__bySrc = cellPopulations.__bySrc || Object.create(null));
          (cellPopulations.__bySrc[evt.src] = cellPopulations.__bySrc[evt.src] || Object.create(null));
          cellPopulations.__bySrc[evt.src][cell] =
            (cellPopulations.__bySrc[evt.src][cell] || 0) + 1;
          break;
        }

        case 'def': {
          allDefs.push(evt);
          const aid = evt.target;
          const kind = evt.kind;
          const opKey = operandKey(kind, evt.operand);
          (defStacks[aid] = defStacks[aid] || Object.create(null));
          (defStacks[aid][kind] = defStacks[aid][kind] || Object.create(null));
          (defStacks[aid][kind][opKey] = defStacks[aid][kind][opKey] || []).push(evt);
          break;
        }

        case 'rec': {
          const aid = evt.target;
          (recBoundaries[aid] = recBoundaries[aid] || []).push(evt);
          break;
        }
      }
    }

    // Sort DEF stacks by the active cursor. REC boundaries similarly.
    for (const aid of Object.keys(defStacks)) {
      for (const kind of Object.keys(defStacks[aid])) {
        for (const opKey of Object.keys(defStacks[aid][kind])) {
          defStacks[aid][kind][opKey].sort((a, b) =>
            readCursor(a, cursor).localeCompare(readCursor(b, cursor))
          );
        }
      }
    }
    for (const aid of Object.keys(recBoundaries)) {
      recBoundaries[aid].sort((a, b) =>
        readCursor(a, cursor).localeCompare(readCursor(b, cursor))
      );
    }

    // ---------------------------------------------------------------
    // Per-anchor cell populations.
    //
    // An anchor's first_seen names a src; observations sharing that src
    // contribute to its cell-population count. This is conservative —
    // richer anchor↔observation matching belongs in the anchoring stage,
    // not in the fold.
    // ---------------------------------------------------------------
    for (const aid of Object.keys(anchors)) {
      const a = anchors[aid];
      observationsByAnchor[aid] = [];
      const bySrc = cellPopulations.__bySrc || {};
      const cellsForAnchor = Object.create(null);
      for (const obs of observations) {
        // The src field is 'doc:N:cl:M'; anchor.first_seen is the same string
        // for the anchoring observation. Document-level matching uses the
        // 'doc:N' prefix.
        const docPrefix = (a.first_seen || '').split(':cl:')[0];
        if (docPrefix && obs.src.startsWith(docPrefix)) {
          observationsByAnchor[aid].push(obs);
          const cell = Array.isArray(obs.phasepost)
            ? '[' + obs.phasepost.join(',') + ']'
            : '[unknown]';
          cellsForAnchor[cell] = (cellsForAnchor[cell] || 0) + 1;
        }
      }
      cellPopulations[aid] = cellsForAnchor;
    }
    delete cellPopulations.__bySrc;

    // ---------------------------------------------------------------
    // Project DEF stacks under the active Horizon.
    //
    // For each (anchor, kind, operand-key), σ chooses a winner — except
    // for `comparative` and `manual`, which return the full stack and a
    // pending flag respectively. Contradictions surface when more than
    // one operand-key under (anchor, kind) has a live winner whose
    // operands disagree (semantic equality is value-equality of the
    // operand object after canonicalization).
    // ---------------------------------------------------------------
    const projections = Object.create(null);
    const contradictions = [];

    for (const aid of Object.keys(defStacks)) {
      projections[aid] = Object.create(null);
      for (const kind of Object.keys(defStacks[aid])) {
        const buckets = defStacks[aid][kind];
        const perKind = {
          buckets: {},
          live: [],          // operand-key -> winner (under non-comparative σ)
          stacks: {},        // full chronological stack per bucket (for UI)
          pending_manual: false,
          comparative: false
        };
        for (const opKey of Object.keys(buckets)) {
          const stack = filterPostRec(buckets[opKey], recBoundaries[aid] || [], cursor, sig);
          const r = resolveSigma(stack, activeHorizon, kind);
          perKind.buckets[opKey] = r;
          perKind.stacks[opKey] = stack;
          if (r.comparative) perKind.comparative = true;
          if (r.pending_manual) perKind.pending_manual = true;
          if (r.winner) perKind.live.push({ opKey, winner: r.winner });
        }
        projections[aid][kind] = perKind;

        // Contradiction surfacing.
        //
        // Different operand-keys are orthogonal facts (a name + an
        // employee_count, or a BFO lens + a DOLCE lens) — never a
        // contradiction. Contradictions live INSIDE a bucket: σ can't
        // pick a winner, yet competing operands exist. Two ways that
        // happens under built-in σ:
        //   - σ=manual on a bucket with ≥2 events (pending_manual)
        //   - tied cursors: two events at the same cursor value with
        //     different operands, even σ=latest can't break the tie
        //     deterministically (we pick lexicographic, but flag).
        for (const opKey of Object.keys(perKind.buckets)) {
          const r = perKind.buckets[opKey];
          const stack = perKind.stacks[opKey] || [];
          if (stack.length < 2) continue;
          if (r.pending_manual) {
            contradictions.push({
              aid, kind, opKey,
              live: stack.map(e => ({ event_id: e.id })),
              note: 'σ=manual — awaiting human resolution'
            });
            continue;
          }
          // Tied cursor with disagreeing operands within a bucket.
          if (r.winner) {
            const winnerCursor = readCursor(r.winner, cursor);
            const ties = stack.filter(e =>
              readCursor(e, cursor) === winnerCursor && e.id !== r.winner.id
            );
            const disagreeing = ties.filter(e =>
              canonicalKey(e.operand) !== canonicalKey(r.winner.operand)
            );
            if (disagreeing.length) {
              contradictions.push({
                aid, kind, opKey,
                live: [r.winner, ...disagreeing].map(e => ({ event_id: e.id })),
                note: 'tied ' + cursor + ' cursor with disagreeing operands'
              });
            }
          }
        }
      }
    }

    // ---------------------------------------------------------------
    // Anchor liveness within the Horizon's temporal window.
    //
    // An anchor is live if any DEF or observation references it within
    // the window. Window comes from sig.window = { from, to } — both
    // optional. No window = always live.
    // ---------------------------------------------------------------
    const window = sig.window || {};
    const liveAnchors = new Set();
    for (const aid of Object.keys(anchors)) {
      let live = false;
      for (const obs of observationsByAnchor[aid] || []) {
        if (inWindow(obs.ts, window)) { live = true; break; }
      }
      if (!live) {
        const stacks = defStacks[aid] || {};
        outer: for (const kind of Object.keys(stacks)) {
          for (const opKey of Object.keys(stacks[kind])) {
            for (const evt of stacks[kind][opKey]) {
              if (inWindow(readCursor(evt, cursor), window)) { live = true; break outer; }
            }
          }
        }
      }
      if (live || (!window.from && !window.to)) liveAnchors.add(aid);
    }

    // ---------------------------------------------------------------
    // Agent reliability — derivable, not stored. Counts how often each
    // agent's DEFs are superseded vs survive under the active σ for
    // operand-keys that have at least two events. Available to UIs that
    // want to surface it; ignored otherwise.
    // ---------------------------------------------------------------
    const agentStats = Object.create(null);
    for (const aid of Object.keys(defStacks)) {
      for (const kind of Object.keys(defStacks[aid])) {
        for (const opKey of Object.keys(defStacks[aid][kind])) {
          const stack = defStacks[aid][kind][opKey];
          if (stack.length < 2) continue;
          for (let i = 0; i < stack.length - 1; i++) {
            const evt = stack[i];
            (agentStats[evt.agent] = agentStats[evt.agent] || { superseded: 0, survived: 0 })
              .superseded++;
          }
          const last = stack[stack.length - 1];
          (agentStats[last.agent] = agentStats[last.agent] || { superseded: 0, survived: 0 })
            .survived++;
        }
      }
    }

    return {
      horizon: activeHorizon,
      anchors,
      liveAnchors: Array.from(liveAnchors),
      projections,
      defStacks,
      recBoundaries,
      cellPopulations,
      observationsByAnchor,
      contradictions,
      horizonsInLog,
      agentStats,
      defCount: allDefs.length,
      observationCount: observations.length
    };
  }

  // ---------------------------------------------------------------
  // REC frame boundary handling.
  //
  // A REC reframes a target. Spec: "queries under the new frame skip
  // [pre-REC DEFs] unless σ explicitly includes pre-REC DEFs". We honor
  // a sig.include_pre_rec === true escape hatch; default is to drop.
  // ---------------------------------------------------------------
  function filterPostRec(stack, recs, cursor, sig) {
    if (!recs.length || sig.include_pre_rec) return stack;
    const lastRec = recs[recs.length - 1];
    const recCursor = readCursor(lastRec, cursor);
    return stack.filter(evt => readCursor(evt, cursor) >= recCursor);
  }

  function inWindow(ts, window) {
    if (!window || (!window.from && !window.to)) return true;
    if (window.from && ts < window.from) return false;
    if (window.to && ts > window.to) return false;
    return true;
  }

  function canonicalKey(value) {
    if (global.EOFormat && typeof global.EOFormat.canonicalizeForHash === 'function') {
      try { return global.EOFormat.canonicalizeForHash(value); } catch { /* fall through */ }
    }
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  global.AnchorageFold = {
    fold,
    builtinHorizons,
    operandKey,
    resolveSigma,
    readCursor,
    effectiveMethod
  };
})(typeof window !== 'undefined' ? window : globalThis);
