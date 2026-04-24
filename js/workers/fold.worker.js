self.addEventListener('message', (ev) => {
  const { type, events, entities } = ev.data;
  if (type !== 'fold') return;

  // Three projected views per the EO split:
  //   G (Given-Log)  — observations: what was read, where
  //   M (Meant-Graph)— interpretations: claims with π links into G
  //   S (lattice)    — positional context (workspace, article, paragraph)
  // CLAIMS is the render-ready projection of M (M + π resolved).
  const G = {};
  const M = {};
  const S = {};
  const claims = {};
  const sources = {};
  const entityIndex = {}; // entity_id -> [obsId, ...] (only resolved, non-retracted OBS)

  // Entity mentions (Phase 8, Task 28) are synthesized at projection time
  // from OBS entries with mode 'ner' | 'coref' | 'rule', resolved against
  // the caller-supplied entities table. They are NOT log events — rule
  // edits propagate on the next fold without re-ingesting sources.
  const mentions = {}; // mentionId -> M-entry shape

  // Stage 1 — DEF projection. D[obsId] carries { boundary, type, link }
  // payloads for that observation; corefs land in D.__coref; alias
  // proposals in D.__aliases. pendingReview is the queue of link DEFs
  // in band='review' plus alias proposals. amberMentions is a set
  // (object) of mentionIds whose DEF-link band is 'amber'.
  const D = {};
  const pendingReview = [];
  const amberMentions = {};
  const defCounts = { boundary: 0, type: 0, link: 0, coref: 0, alias: 0 };

  // Stage 2/3/5 projections.
  // - eventsById     : event_id -> raw event (used by Stage 5 gates).
  // - evaPressure    : target_event_id -> accumulated weighted verdicts
  //                     plus a copy of the target DEF payload (for the
  //                     rewrite engine's trigger readout).
  // - recEvents      : event_id -> REC payload (for audit + counter-REC).
  // - alreadyRewritten : set of "kind:key" strings, one per REC that has
  //                     already fired for a given trigger (keeps the
  //                     rewrite engine idempotent across refolds).
  // - ruleSetVersion : the latest rs_v* string observed on a REC event,
  //                     or 'rs_v1' if no RECs have landed yet.
  // - pendingConsistencyEvas : fold-detected contradictions that the
  //                     main thread will emit as system EVAs.
  const eventsById = {};
  const evaPressure = {};
  const recEvents = {};
  const alreadyRewritten = new Set();
  let   ruleSetVersion = 'rs_v1';
  const pendingConsistencyEvas = [];
  // Stage 3i — prompt-addition proposal queue. Fold clusters rejects
  // by (surface_lower, source_id, wrong_target_entity_id); if a cluster
  // hits ≥5 rejects, a proposal string is surfaced for human approval.
  const promptProposals = [];

  for (const raw of events) {
    let evt;
    try { evt = JSON.parse(raw); } catch { continue; }

    // Index every event by id so downstream gates (Stage 5 EVA + REC)
    // can validate target_event references without re-walking the log.
    if (evt && evt.id) eventsById[evt.id] = evt;

    // OBS — a G-entry. An observation: someone read this content at this
    // location at this time. The atomic unit of provenance.
    if (evt.op === 'OBS' && evt.site && evt.site.startsWith('observation:')) {
      const obsId = evt.site.slice('observation:'.length);
      const p = evt.payload || {};
      const mode = p.mode || 'direct_read';
      // Any machine-authored mode — NER, coref, rule-driven — carries an
      // agent_kind='model' flag so downstream filters can separate derived
      // signal from human reads. agent is the model identifier string.
      const agentKind = (mode === 'ner' || mode === 'coref' || mode === 'rule')
        ? 'model'
        : (typeof p.agent === 'string' && p.agent.startsWith('model:') ? 'model' : 'human');
      G[obsId] = {
        id: obsId,
        ts: evt.ts,
        agent: p.agent,
        agent_kind: agentKind,
        mode,
        source_id: p.source_id,
        location: p.location,
        content: p.content,
        entity_type: p.entity_type || null,
        context: p.context || null,
        retracted: false,
        sigma: []
      };
      continue;
    }

    // REC on an observation — retract a derived OBS. The entry stays in
    // G (the log is append-only) but is flagged so entity synthesis
    // skips it. Misclassified NER hits are corrected exactly like
    // user-authored claims. (Task 29)
    if (evt.op === 'REC' && evt.site && evt.site.startsWith('observation:')) {
      const id = evt.site.slice('observation:'.length);
      if (!G[id]) continue;
      const s = evt.payload && evt.payload.new_status;
      if (s === 'retracted') G[id].retracted = true;
      G[id].sigma.push({
        op: 'REC',
        event_id: evt.id,
        action: evt.payload && evt.payload.action,
        new_status: s,
        supersedes: (evt.payload && evt.payload.supersedes) || [],
        ts: evt.ts
      });
      continue;
    }

    // CLAIM — an M-entry. An interpretation made in an article, linked
    // back to observations by π (pi). Projects into CLAIMS for render.
    if (evt.op === 'CLAIM' && evt.site && evt.site.startsWith('claim:')) {
      const claimId = evt.site.slice('claim:'.length);
      const p = evt.payload || {};
      M[claimId] = {
        id: claimId,
        ts: evt.ts,
        type: p.type || 'grounded',
        text: p.text,
        pi: p.pi || [],
        position: p.position || null,
        window: p.window || null,
        conf: p.conf != null ? p.conf : 0.9,
        prov_content: p.prov_content,
        trace: p.trace || []
      };
      // Record S-lattice coordinate
      if (p.position) {
        const key = (p.position.workspace || 'local') + '/' + (p.position.article_id || 'draft') + '/' + (p.position.paragraph_id || '0');
        (S[key] = S[key] || []).push(claimId);
      }
      // Render-ready projection
      claims[claimId] = {
        type: M[claimId].type,
        text: M[claimId].text,
        conf: M[claimId].conf,
        status: 'pending',
        prov: p.prov_content,
        trace: M[claimId].trace,
        pi: M[claimId].pi,
        window: M[claimId].window,
        position: M[claimId].position
      };
      continue;
    }

    // SEED — initial claim state (carries the full pre-authored shape).
    if (evt.op === 'SEED' && evt.payload && evt.payload.claim_id) {
      claims[evt.payload.claim_id] = {
        ...evt.payload.claim,
        status: 'pending'
      };
      continue;
    }

    // CITE — legacy user-authored citation. New code emits OBS+CLAIM;
    // this handler stays for forward-compat with existing log entries.
    if (evt.op === 'CITE' && evt.payload && evt.payload.claim_id) {
      claims[evt.payload.claim_id] = {
        ...evt.payload.claim,
        status: 'pending'
      };
      continue;
    }

    // SRC — source added to the library
    if (evt.op === 'SRC' && evt.payload && evt.payload.id) {
      sources[evt.payload.id] = {
        id: evt.payload.id,
        name: evt.payload.name,
        kind: evt.payload.kind,
        meta: evt.payload.meta || '',
        mime: evt.payload.mime || '',
        size: evt.payload.size || 0,
        has_text: evt.payload.has_text !== false,
        indexed: true,
        user_added: true,
        destination: evt.payload.destination || 'local',
        archive_url: evt.payload.archive_url || null,
        archive_identifier: evt.payload.archive_identifier || null,
        matrix_mxc: evt.payload.matrix_mxc || null,
        matrix_room_id: evt.payload.matrix_room_id || null,
        sha256: evt.payload.sha256 || null,
        // PDF (or any non-text source) carries an extraction audit
        // describing exactly how its plain text was obtained — native
        // PDF text vs. OCR — and a flag for whether the original
        // binary is preserved in OPFS for re-rendering.
        extraction: evt.payload.extraction || null,
        has_blob: !!evt.payload.has_blob
      };
      continue;
    }

    // SRC_DEL — remove a user-added source
    if (evt.op === 'SRC_DEL' && evt.site && evt.site.startsWith('source:')) {
      const sid = evt.site.slice('source:'.length);
      delete sources[sid];
      continue;
    }

    // EVA on a claim: an evaluation. Later EVA events supersede earlier
    // ones; the latest reading wins. The fold stores a σ-chain so readers
    // can walk supersessions back.
    if (evt.op === 'EVA' && evt.site && evt.site.startsWith('claim:')
        && !(evt.payload && evt.payload.target_event)) {
      // Legacy claim-EVA handler: new_status + sigma chain on the
      // claim itself. Stage 2 DEF-EVAs (which carry target_event)
      // fall through to the projection block below.
      const id = evt.site.slice('claim:'.length);
      if (!claims[id]) continue;
      const s = evt.payload && evt.payload.new_status;
      if (s) claims[id].status = s;
      (claims[id].sigma = claims[id].sigma || []).push({
        op: 'EVA',
        event_id: evt.id,
        action: evt.payload && evt.payload.action,
        new_status: s,
        supersedes: (evt.payload && evt.payload.supersedes) || [],
        ts: evt.ts
      });
      continue;
    }

    // LINK — build a relational claim (conflict or concur) from two prior
    // claims. The new claim references both; resolution stays open until
    // the user acts on it with the typed verbs.
    if (evt.op === 'LINK' && evt.site && evt.site.startsWith('claim:')) {
      const newId = evt.site.slice('claim:'.length);
      const aId = evt.payload && evt.payload.claim_a;
      const bId = evt.payload && evt.payload.claim_b;
      const a = claims[aId];
      const b = claims[bId];
      if (!a || !b) continue;
      const kind = (evt.payload && evt.payload.kind) === 'concur' ? 'concur' : 'conflict';
      const digest = (id, c) => {
        const p = c.prov || {};
        let loc = '';
        let value = '';
        if (p.kind === 'quote')    { loc = p.page ? (p.src + ' · p.' + p.page) : p.src; value = p.highlight || ''; }
        else if (p.kind === 'cell'){ loc = p.src + ' · row ' + p.row + ' · ' + p.col; value = p.value || ''; }
        else if (p.kind === 'cells'){ loc = (p.src || 'cells') + ' · ' + (p.cellCount || 0) + ' cells'; value = (p.columns || []).join(', '); }
        else if (p.kind === 'derived') { loc = (p.src || 'derived'); value = p.result || ''; }
        return { id, text: c.text, kind: p.kind || '', src: p.src || '', loc, value };
      };
      claims[newId] = {
        type: kind,
        text: a.text,
        conf: Math.min(a.conf || 1, b.conf || 1),
        status: 'pending',
        prov: {
          kind,
          claim_a: digest(aId, a),
          claim_b: digest(bId, b),
          reason: (evt.payload && evt.payload.reason) || null
        },
        trace: [
          { op: 'CON', txt: 'two claims linked by a reviewer' },
          { op: 'EVA', txt: kind + ' relation registered — pending resolution' }
        ]
      };
      continue;
    }

    // DEF — Stage 1 typed classification event. Subtypes:
    //   boundary, type, link (keyed by obsId via evt.site or payload.pi),
    //   coref (keyed by link:<corefId>),
    //   alias (keyed by proposal:<aliasId>, awaiting human confirm).
    if (evt.op === 'DEF' && evt.payload && evt.payload.subtype) {
      const p = evt.payload;
      if (p.subtype === 'boundary' && evt.site && evt.site.startsWith('observation:')) {
        const obsId = evt.site.slice('observation:'.length);
        (D[obsId] = D[obsId] || {}).boundary = Object.assign({ event_id: evt.id, ts: evt.ts }, p);
        defCounts.boundary++;
        continue;
      }
      if (p.subtype === 'type' && evt.site && evt.site.startsWith('observation:')) {
        const obsId = evt.site.slice('observation:'.length);
        (D[obsId] = D[obsId] || {}).type = Object.assign({ event_id: evt.id, ts: evt.ts }, p);
        defCounts.type++;
        continue;
      }
      if (p.subtype === 'link') {
        const obsId = Array.isArray(p.pi) ? p.pi[0] : null;
        if (obsId) (D[obsId] = D[obsId] || {}).link = Object.assign({ event_id: evt.id, ts: evt.ts }, p);
        defCounts.link++;
        if (p.band === 'review') pendingReview.push({ kind: 'link', event_id: evt.id, ts: evt.ts, payload: p });
        if (p.band === 'amber' && p.mention_id) amberMentions[p.mention_id] = true;
        continue;
      }
      if (p.subtype === 'coref') {
        (D.__coref = D.__coref || []).push({ event_id: evt.id, ts: evt.ts, payload: p });
        defCounts.coref++;
        continue;
      }
      if (p.subtype === 'alias') {
        (D.__aliases = D.__aliases || []).push({ event_id: evt.id, ts: evt.ts, payload: p });
        defCounts.alias++;
        pendingReview.push({ kind: 'alias', event_id: evt.id, ts: evt.ts, payload: p });
        continue;
      }
      // web_evidence: Claude proposes a URL + excerpt + archive.org
      // snapshot as corroboration for a specific claim. Goes into the
      // pending review queue; only a human ⊨EVA confirm binds it.
      if (p.subtype === 'web_evidence') {
        (D.__web_evidence = D.__web_evidence || []).push({ event_id: evt.id, ts: evt.ts, payload: p });
        pendingReview.push({ kind: 'web_evidence', event_id: evt.id, ts: evt.ts, payload: p });
        continue;
      }
      // Unknown subtype — skip silently; the log is forward-compatible.
      continue;
    }

    // CORROBORATE — append an approved web-evidence corroboration onto
    // an existing claim. Emitted only after a human EVA-confirm on the
    // upstream DEF(web_evidence) proposal. Does NOT replace the claim's
    // primary provenance; it's an additive supporting-evidence array.
    if (evt.op === 'CORROBORATE' && evt.site && evt.site.startsWith('claim:')) {
      const cid = evt.site.slice('claim:'.length);
      const c = claims[cid];
      const cor = evt.payload && evt.payload.corroboration;
      if (c && cor) {
        (c.corroborations = c.corroborations || []).push({
          proposal_id: cor.proposal_id || null,
          source_id: cor.source_id || null,
          source_url: cor.source_url || null,
          archive_url: cor.archive_url || null,
          title: cor.title || null,
          excerpt: cor.excerpt || '',
          rationale: cor.rationale || '',
          confidence: typeof cor.confidence === 'number' ? cor.confidence : null,
          agent: cor.agent || null,
          added_at: evt.ts || null,
          approved_by: (evt.payload && evt.payload.approved_by) || null
        });
      }
      continue;
    }

    // EVA targeting a DEF event. Stage 5 gate: target_event must exist
    // and must itself be a DEF. Reframe_to, if present, must name a
    // known canonical entity id. Invalid EVAs stay in the log but do
    // not contribute weighted pressure. Legacy claim-EVAs (which carry
    // payload.new_status, not target_event) fall through to the
    // existing claim handler below.
    if (evt.op === 'EVA' && evt.payload && evt.payload.target_event) {
      const p = evt.payload;
      const tgtEvt = eventsById[p.target_event];
      let validTarget = tgtEvt && tgtEvt.op === 'DEF';
      // reframe_to (if present) must name a canonical entity.
      if (validTarget && p.reframe_to && p.reframe_to.entity_id) {
        if (!entities || !entities[p.reframe_to.entity_id]) {
          validTarget = false;
        }
      }
      if (validTarget) {
        const verdict = p.verdict;
        const weight  = typeof p.weight === 'number' ? p.weight : 1.0;
        const entry = (evaPressure[p.target_event] = evaPressure[p.target_event] || {
          confirm: 0, reject: 0, reframe: 0, defer: 0,
          count: 0, events: [], target: null
        });
        if (verdict === 'confirm' || verdict === 'reject' || verdict === 'reframe' || verdict === 'defer') {
          entry[verdict] += weight;
        }
        entry.count++;
        entry.events.push({
          event_id: evt.id,
          verdict, weight,
          agent: p.agent,
          ts: evt.ts,
          reframe_to: p.reframe_to || null,
          inferred_from: p.inferred_from || null
        });
        // Cache a compact copy of the target DEF's payload on the
        // pressure entry so the rewrite engine doesn't need the full
        // eventsById table to read trigger conditions.
        if (!entry.target && tgtEvt.payload) {
          const tp = tgtEvt.payload;
          entry.target = {
            subtype: tp.subtype,
            entity_id: tp.entity_id || null,
            candidate_canonical_id: tp.candidate_canonical_id || null,
            alias_matched: tp.alias_matched || null,
            applied_rec: tp.applied_rec || null,
            surface: tp.surface || null,
            source_id: tp.source_id || null,
            confidence: tp.confidence != null ? tp.confidence : null,
            band: tp.band || null,
            rule_set_version: tp.rule_set_version || null,
            mention_id: tp.mention_id || null
          };
        }
        continue;
      }
      // Target unresolved — fall through so legacy handlers downstream
      // still see the event (avoids regressions on existing EVAs).
    }

    // REC on the ruleset itself. Stage 5 REC gate: triggered_by must
    // reference EVAs that exist and whose combined weight meets the
    // rewrite_type's documented threshold. (Rule 4 enforcement.)
    if (evt.op === 'REC' && evt.site && evt.site.startsWith('ruleset:')) {
      const p = evt.payload || {};
      const trig = Array.isArray(p.triggered_by) ? p.triggered_by : [];
      let weight = 0;
      let ok = trig.length > 0;
      for (const eid of trig) {
        const e = eventsById[eid];
        if (!e || e.op !== 'EVA') { ok = false; break; }
        weight += typeof (e.payload && e.payload.weight) === 'number' ? e.payload.weight : 0;
      }
      if (!ok) continue; // gate rejection
      recEvents[evt.id] = Object.assign({ event_id: evt.id, ts: evt.ts }, p);
      // Ruleset version follows the site tag: 'ruleset:rs_v48'.
      const v = evt.site.slice('ruleset:'.length);
      if (/^rs_v\d+$/.test(v)) ruleSetVersion = v;
      // Mark the trigger handled so the rewrite engine doesn't re-fire
      // the same REC on every refold. Key format mirrors runRewriteEngine.
      if (p.rewrite_type === 'alias_add' && p.target && p.change && p.change.add_alias) {
        alreadyRewritten.add('alias_add:' + p.target.entity_id + '|' + p.change.add_alias.toLowerCase());
      } else if (p.rewrite_type === 'alias_remove' && p.target && p.change && p.change.remove_alias) {
        alreadyRewritten.add('alias_remove:' + p.target.entity_id + '|' + p.change.remove_alias.toLowerCase());
      } else if (p.rewrite_type === 'entity_split' && p.target && p.target.entity_id) {
        alreadyRewritten.add('entity_split:' + p.target.entity_id);
      } else if (p.rewrite_type === 'threshold_lower' && p.target && p.target.entity_id) {
        alreadyRewritten.add('threshold_lower:' + p.target.entity_id);
      } else if (p.rewrite_type === 'threshold_raise' && p.target && p.target.entity_id) {
        alreadyRewritten.add('threshold_raise:' + p.target.entity_id);
      } else if (p.rewrite_type === 'type_rule' && p.target && p.target.entity_id && p.change) {
        const k = [p.target.entity_id, (p.change.surface || '').toLowerCase(),
                   (p.change.context_hint || '').toLowerCase(), p.change.type || ''].join('|');
        alreadyRewritten.add('type_rule:' + k);
      } else if (p.rewrite_type === 'revert' && p.target && p.target.reverts) {
        alreadyRewritten.add('counter_rec:' + p.target.reverts);
      } else if (p.rewrite_type === 'prototype_update') {
        const firstTrig = trig[0];
        if (firstTrig) alreadyRewritten.add('prototype:' + firstTrig);
      }
      continue;
    }

    // REC on a claim: a reframe — retract, dissolve, reanchor, fill.
    // Payloads may carry a replacement prov (reanchor/fill).
    if (evt.op === 'REC' && evt.site && evt.site.startsWith('claim:')) {
      const id = evt.site.slice('claim:'.length);
      if (!claims[id]) continue;
      const s = evt.payload && evt.payload.new_status;
      if (s) claims[id].status = s;
      if (evt.payload && evt.payload.prov) claims[id].prov = evt.payload.prov;
      if (evt.payload && evt.payload.type) claims[id].type = evt.payload.type;
      (claims[id].sigma = claims[id].sigma || []).push({
        op: 'REC',
        event_id: evt.id,
        action: evt.payload && evt.payload.action,
        new_status: s,
        supersedes: (evt.payload && evt.payload.supersedes) || [],
        ts: evt.ts
      });
      continue;
    }
  }

  // ---------- Entity resolution (Phase 8, Task 27 + 28) ----------
  // Walk G for derived NER/coref/rule observations. Match each against
  // the resolution table by alias (case-insensitive). On match, synthesize
  // an entity_mention M-entry. Retracted OBS are skipped. Unresolved OBS
  // remain bare observations; the UI can offer a suggest-alias action.
  if (entities && typeof entities === 'object') {
    // Pre-build an alias lookup: lowercase surface -> entity_id.
    // Longest aliases first so "Solaren Risk Management" beats "Solaren".
    const aliasPairs = [];
    for (const [eid, e] of Object.entries(entities)) {
      if (!e || !Array.isArray(e.aliases)) continue;
      for (const a of e.aliases) {
        if (typeof a === 'string' && a.trim()) {
          aliasPairs.push({ alias: a.trim().toLowerCase(), entity_id: eid, type: e.type });
        }
      }
    }
    aliasPairs.sort((x, y) => y.alias.length - x.alias.length);
    const byAlias = new Map();
    for (const p of aliasPairs) {
      if (!byAlias.has(p.alias)) byAlias.set(p.alias, p);
    }

    for (const [obsId, g] of Object.entries(G)) {
      if (g.retracted) continue;
      if (!(g.mode === 'ner' || g.mode === 'coref' || g.mode === 'rule')) continue;
      if (!g.content || typeof g.content !== 'string') continue;
      const key = g.content.trim().toLowerCase();
      let hit = byAlias.get(key);
      // Foreign-key resolution (Task 27): CSV cell obs can resolve via a
      // src:col coordinate if the entity table lists this value there.
      if (!hit && g.location && g.location.col != null && g.source_id && sources[g.source_id]) {
        const srcName = sources[g.source_id].name || '';
        for (const [eid, e] of Object.entries(entities)) {
          const fks = e && e.foreign_keys;
          if (!fks) continue;
          const fkKey = srcName + ':' + g.location.col;
          const vals = fks[fkKey];
          if (Array.isArray(vals) && vals.includes(g.content)) {
            hit = { alias: key, entity_id: eid, type: e.type };
            break;
          }
        }
      }
      if (!hit) continue;

      // Synthesize an entity_mention claim. Site prefix entity_mention:
      // keeps it distinct from user-authored grounded claims.
      const mentionId = 'em_' + obsId;
      const src = sources[g.source_id] || {};
      const locLabel = g.location
        ? (g.location.start != null
            ? ('offset ' + g.location.start + '–' + g.location.end)
            : (g.location.row != null ? ('row ' + g.location.row + ' · ' + g.location.col) : ''))
        : '';
      const mention = {
        id: mentionId,
        derived: true,
        type: 'entity_mention',
        ts: g.ts,
        entity_id: hit.entity_id,
        entity_type: entities[hit.entity_id] ? entities[hit.entity_id].type : hit.type,
        canonical: entities[hit.entity_id] ? entities[hit.entity_id].canonical : null,
        surface: g.content,
        conf: 0.85,
        pi: [obsId],
        position: g.context || null,
        source_id: g.source_id,
        source_name: src.name || null,
        location: g.location,
        location_label: locLabel,
        trace: [
          { op: 'OBS', txt: '[' + g.mode + '] ' + (g.agent || 'model') + ' read "' + g.content + '"' + (src.name ? ' in ' + src.name : '') },
          { op: 'CLAIM', txt: 'entity_mention resolved to ' + hit.entity_id }
        ]
      };
      M[mentionId] = mention;
      mentions[mentionId] = mention;
      (entityIndex[hit.entity_id] = entityIndex[hit.entity_id] || []).push(obsId);
    }
  }

  // Overlay Stage 1 DEF-link metadata onto synthesized mentions so the
  // UI can read confidence band, rationale, rule_set_version, and
  // alternatives off the mention without re-walking D. Stage 6 adds
  // stale tagging: any DEF whose rule_set_version is older than the
  // current one is flagged — stale is a view-time signal, never a
  // mutation of the underlying event.
  const staleSources = new Set();
  const staleCounts = { boundary: 0, type: 0, link: 0 };
  for (const [obsId, d] of Object.entries(D)) {
    if (obsId === '__coref' || obsId === '__aliases' || !d) continue;
    const markStale = (def, kind) => {
      if (!def) return;
      if (def.rule_set_version && def.rule_set_version !== ruleSetVersion) {
        def.stale = true;
        staleCounts[kind] = (staleCounts[kind] || 0) + 1;
      }
    };
    markStale(d.boundary, 'boundary');
    markStale(d.type, 'type');
    markStale(d.link, 'link');
    if (d.boundary && d.boundary.stale && d.boundary.source_id) {
      staleSources.add(d.boundary.source_id);
    }
    if (!d.link) continue;
    const l = d.link;
    const mentionId = l.mention_id || ('em_' + obsId);
    const m = mentions[mentionId];
    if (!m) continue;
    if (typeof l.confidence === 'number') m.def_confidence = l.confidence;
    if (l.band) m.def_band = l.band;
    if (l.rule_set_version) m.rule_set_version = l.rule_set_version;
    if (l.rationale) m.def_rationale = l.rationale;
    if (Array.isArray(l.alternatives)) m.def_alternatives = l.alternatives;
    if (l.stale) m.stale = true;
  }

  // ---------- Stage 2c: system consistency pass ----------
  // The fold stays pure — it does not append events. Instead it
  // surfaces detected contradictions as pendingConsistencyEvas, which
  // the main thread reads and emits via emitSystemEva. This preserves
  // the append-only log invariant and keeps the worker deterministic.
  //
  // Two detectors covered in this cut:
  //   1. A coref chain whose members resolve to conflicting entity ids
  //      via their DEF-link payloads — one or both links are wrong.
  //   2. Two DEF-boundary events that assert different type_candidates
  //      for the same surface within the same source — tie to review.
  (function detectConsistency() {
    const corefChains = Array.isArray(D.__coref) ? D.__coref : [];
    for (const chain of corefChains) {
      const members = chain.payload && Array.isArray(chain.payload.members) ? chain.payload.members : [];
      const seen = new Map(); // entity_id -> obsId[]
      for (const obsId of members) {
        const d = D[obsId];
        const eid = d && d.link && d.link.entity_id;
        if (!eid) continue;
        const bucket = seen.get(eid) || [];
        bucket.push(obsId);
        seen.set(eid, bucket);
      }
      if (seen.size > 1) {
        // The chain says these are the same referent; the links
        // disagree. Flag every link in the chain for review.
        const related = [];
        for (const obsId of members) {
          const d = D[obsId];
          if (d && d.link && d.link.event_id) related.push(d.link.event_id);
        }
        for (const obsId of members) {
          const d = D[obsId];
          const linkEvt = d && d.link;
          if (!linkEvt || !linkEvt.event_id) continue;
          pendingConsistencyEvas.push({
            target_event: linkEvt.event_id,
            target_site: 'claim:' + (linkEvt.mention_id || ('em_' + obsId)),
            verdict: 'reject',
            detected: 'coref_chain_disagrees',
            related_events: related
          });
        }
      }
    }
    // Surface+source type disagreements.
    const bySurfaceSource = new Map();
    for (const [obsId, d] of Object.entries(D)) {
      if (obsId === '__coref' || obsId === '__aliases' || !d || !d.boundary) continue;
      const b = d.boundary;
      if (!b.surface || !b.source_id) continue;
      const key = b.source_id + '|' + b.surface.toLowerCase();
      const bucket = bySurfaceSource.get(key) || [];
      bucket.push({ obsId, boundary: b });
      bySurfaceSource.set(key, bucket);
    }
    for (const bucket of bySurfaceSource.values()) {
      if (bucket.length < 2) continue;
      const types = new Set(bucket.map(e => e.boundary.type_candidate || 'UNK'));
      if (types.size < 2) continue;
      const related = bucket.map(e => e.boundary.event_id).filter(Boolean);
      for (const { obsId, boundary } of bucket) {
        if (!boundary.event_id) continue;
        pendingConsistencyEvas.push({
          target_event: boundary.event_id,
          target_site: 'observation:' + obsId,
          verdict: 'defer',
          detected: 'surface_type_disagrees',
          related_events: related
        });
      }
    }
  })();

  // ---------- Stage 3i: prompt-addition proposal clustering ----------
  // Spec: ≥5 rejects of the same error pattern cluster by
  // (surface_pattern, context_pattern, wrong_target) produce a human-
  // review proposal for a workspace-level prompt addition. We key the
  // cluster on (surface.toLowerCase(), source_id, wrong_target_entity_id)
  // — source_id is a reasonable proxy for "context pattern" at this
  // fidelity. The approval flow lives in the main thread (Stage 7 UI).
  (function detectPromptProposals() {
    const byCluster = new Map();
    for (const eventId of Object.keys(evaPressure)) {
      const p = evaPressure[eventId];
      if (!p || !p.target || p.target.subtype !== 'link') continue;
      const rejects = p.events.filter(e => e.verdict === 'reject');
      if (!rejects.length) continue;
      const surface = (p.target.surface || '').toLowerCase();
      const wrong   = p.target.entity_id || 'null';
      const source  = p.target.source_id || '*';
      const key     = surface + '|' + source + '|' + wrong;
      const bucket  = byCluster.get(key) || {
        surface: p.target.surface || '',
        source_id: p.target.source_id || null,
        wrong_target: wrong,
        rejects: [],
        weight: 0
      };
      bucket.rejects.push(...rejects.map(e => e.event_id));
      bucket.weight += rejects.reduce((s, e) => s + e.weight, 0);
      byCluster.set(key, bucket);
    }
    for (const bucket of byCluster.values()) {
      if (bucket.rejects.length < 5) continue;
      promptProposals.push({
        key: bucket.surface + '|' + (bucket.source_id || '*') + '|' + bucket.wrong_target,
        surface: bucket.surface,
        source_id: bucket.source_id,
        wrong_target: bucket.wrong_target,
        reject_count: bucket.rejects.length,
        evidence_weight: bucket.weight,
        triggered_by: bucket.rejects,
        proposed_text: 'When evaluating "' + bucket.surface + '"' +
          (bucket.source_id ? ' in ' + bucket.source_id : '') +
          ', do not resolve to ' + bucket.wrong_target +
          '. This is a repeated reporter correction (' + bucket.rejects.length + ' rejects).'
      });
    }
  })();

  // Hide proposals that have already received any human verdict so the
  // queue stays shallow. Web-evidence proposals in particular vanish
  // once the reporter clicks Confirm or Reject.
  const filteredPendingReview = [];
  for (const row of pendingReview) {
    const eid = row && row.event_id;
    const pressure = eid && evaPressure[eid];
    if (pressure && pressure.count && pressure.count > 0) continue;
    filteredPendingReview.push(row);
  }

  // Per-claim counts of pending web-evidence proposals, so the claim
  // detail panel can surface "3 web-evidence proposals pending" even
  // when the Stage 7 modal isn't open.
  const webEvidencePendingByClaim = {};
  for (const row of filteredPendingReview) {
    if (row.kind !== 'web_evidence') continue;
    const cid = row.payload && row.payload.claim_id;
    if (!cid) continue;
    webEvidencePendingByClaim[cid] = (webEvidencePendingByClaim[cid] || 0) + 1;
  }

  self.postMessage({
    type: 'state',
    claims, sources, G, M, S, mentions, entityIndex,
    D, pendingReview: filteredPendingReview, amberMentions, defCounts,
    evaPressure, recEvents, alreadyRewritten: Array.from(alreadyRewritten),
    ruleSetVersion, pendingConsistencyEvas,
    staleCounts, staleSources: Array.from(staleSources),
    promptProposals,
    webEvidencePendingByClaim
  });
});
