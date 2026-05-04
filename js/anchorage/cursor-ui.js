/* ===========================================================================
   ANCHORAGE — cursor UI
   ---------------------------------------------------------------------------
   Click any anchor reference; the cursor renders:
     - current projected value(s) under the active Horizon, per kind
     - full DEF stack, sorted by asserted_at, with provenance per event
     - σ resolution explanation — why the active Horizon projects this value
     - authoring affordance — emit a new DEF from the current human user
     - comparative toggle — show all live DEFs side by side regardless of σ

   New DEFs append. Nothing overwrites. The substrate's audit trail is data.

   Public surface:
     AnchorageCursor.mount(rootEl, deps)
       deps = { getProjection, getEvents, getActiveHorizon, setActiveHorizon,
                appendDefEvent, currentUser }
     AnchorageCursor.renderAnchorList(listEl, projection)
     AnchorageCursor.renderCursor(panelEl, aid, projection, deps)
============================================================================ */

(function (global) {
  'use strict';

  const KIND_ORDER = ['classification', 'property', 'relation', 'scope', 'lens'];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  function fmtCursor(c) {
    if (!c) return '<span class="aoc-na">—</span>';
    return escapeHtml(c);
  }

  function operandSummary(kind, operand) {
    if (!operand || typeof operand !== 'object') return '<em>null</em>';
    switch (kind) {
      case 'classification': {
        const cells = Array.isArray(operand.cells)
          ? operand.cells.map(c => '[' + c.join(',') + ']').join(' ')
          : '';
        return escapeHtml(cells || JSON.stringify(operand));
      }
      case 'property':
        return escapeHtml((operand.property_type || operand.type || 'property') +
                          ' = ' + JSON.stringify(operand.value));
      case 'relation':
        return escapeHtml((operand.operator || 'REL') + '(' +
          (Array.isArray(operand.targets) ? operand.targets.join(', ') : '') + ')');
      case 'scope':
        return escapeHtml(JSON.stringify(operand));
      case 'lens':
        return escapeHtml((operand.framework || 'lens') + ' · ' +
          (operand.category || JSON.stringify(operand)));
      default:
        return escapeHtml(JSON.stringify(operand));
    }
  }

  function explainSigma(horizon, kind, bucketResult) {
    const sig = (horizon && horizon.sigma) || {};
    const method = (sig.kinds && sig.kinds[kind]) || sig.method || 'latest';
    const cursor = sig.cursor || 'asserted_at';
    if (bucketResult.comparative) {
      return 'Comparative σ — full live stack returned, no projection.';
    }
    if (bucketResult.pending_manual) {
      return 'Manual σ — flagged for human resolution. Append a new DEF to resolve.';
    }
    const w = bucketResult.winner;
    if (!w) return 'No live DEF in this bucket.';
    switch (method) {
      case 'latest':
        return 'σ=latest on ' + cursor + ' — most recent ' + cursor +
               ' wins (' + (w.cursors && w.cursors[cursor] || w.ts) + ').';
      case 'agent_priority':
      case 'source_priority': {
        const weights = (sig.weights || {});
        const w_ = weights[w.agent] != null ? weights[w.agent] : 0;
        return 'σ=' + method + ' — agent "' + w.agent + '" priority ' + w_ + '.';
      }
      case 'historical':
        return 'σ=historical as of ' + (sig.as_of || sig.cutoff || '?') +
               ' — latest event before cutoff.';
      default:
        return 'σ=' + method + '.';
    }
  }

  // ---------------------------------------------------------------
  // Anchor list — left rail of the cursor panel.
  //
  // Sorted by aid; flag any anchor with a contradiction or a pending
  // manual resolution under the active Horizon.
  // ---------------------------------------------------------------
  function renderAnchorList(listEl, projection) {
    if (!listEl) return;
    const aids = Object.keys(projection.anchors || {}).sort();
    if (!aids.length) {
      listEl.innerHTML = '<div class="aoc-empty">No anchors. Load an .eo file or extract from a source.</div>';
      return;
    }
    const contradictionByAid = new Set(
      (projection.contradictions || []).map(c => c.aid)
    );
    const live = new Set(projection.liveAnchors || aids);
    const html = aids.map(aid => {
      const flag = contradictionByAid.has(aid) ? '<span class="aoc-flag aoc-contradicted" title="Contradiction under active Horizon">⚠</span>' : '';
      const dim = live.has(aid) ? '' : ' aoc-anchor-dim';
      const cellMap = (projection.cellPopulations && projection.cellPopulations[aid]) || {};
      const total = Object.values(cellMap).reduce((s, n) => s + n, 0);
      const dom = Object.entries(cellMap).sort((a, b) => b[1] - a[1])[0];
      const domLabel = dom ? `${dom[0]} ×${dom[1]}` : '—';
      return `
        <button class="aoc-anchor-row${dim}" data-aid="${escapeHtml(aid)}">
          <span class="aoc-anchor-aid">${escapeHtml(aid)}</span>${flag}
          <span class="aoc-anchor-meta">${total} obs · ${escapeHtml(domLabel)}</span>
        </button>`;
    }).join('');
    listEl.innerHTML = html;
  }

  // ---------------------------------------------------------------
  // Cursor — full DEF stack at one anchor.
  //
  // Layout per kind:
  //   - section header with σ method + cursor explanation
  //   - per-bucket stack (full chronological list, not just winner)
  //   - active winner highlighted
  //   - "Author new DEF" affordance
  // ---------------------------------------------------------------
  function renderCursor(panelEl, aid, projection, deps) {
    if (!panelEl) return;
    if (!aid) {
      panelEl.innerHTML = '<div class="aoc-empty">Select an anchor.</div>';
      return;
    }
    const anchor = (projection.anchors || {})[aid];
    if (!anchor) {
      panelEl.innerHTML = `<div class="aoc-empty">Unknown anchor: ${escapeHtml(aid)}</div>`;
      return;
    }
    const horizon = (deps && deps.getActiveHorizon && deps.getActiveHorizon())
      || global.AnchorageFold.builtinHorizons.latest;
    const perAnchor = (projection.projections || {})[aid] || {};
    const cells = (projection.cellPopulations || {})[aid] || {};
    const cellTotal = Object.values(cells).reduce((s, n) => s + n, 0);
    const cellList = Object.entries(cells).sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `<span class="aoc-cell">${escapeHtml(c)}<span class="aoc-cell-n">×${n}</span></span>`).join('');

    const sections = KIND_ORDER.map(kind => renderKindSection(aid, kind, perAnchor[kind], horizon)).join('');

    const contradictions = (projection.contradictions || []).filter(c => c.aid === aid);
    const contraHtml = contradictions.length
      ? `<div class="aoc-contradictions">
           <div class="aoc-contra-head">Contradiction surfaced</div>
           ${contradictions.map(c => `<div class="aoc-contra-row">${escapeHtml(c.kind)}: ${c.live.length} live winners disagree under σ — ${escapeHtml(c.note)}</div>`).join('')}
         </div>`
      : '';

    panelEl.innerHTML = `
      <div class="aoc-cursor">
        <header class="aoc-cursor-head">
          <div class="aoc-cursor-aid">${escapeHtml(aid)}</div>
          <div class="aoc-cursor-meta">first_seen: ${escapeHtml(anchor.first_seen || '—')} · ${cellTotal} observations</div>
          ${cellList ? `<div class="aoc-cells">${cellList}</div>` : ''}
        </header>
        ${contraHtml}
        ${sections}
        <footer class="aoc-cursor-foot">
          <button class="aoc-author-toggle" data-author-toggle>+ author new DEF</button>
          <div class="aoc-author-form" hidden>
            <label>kind
              <select class="aoc-author-kind">
                ${global.EOFormat.DEF_KINDS.map(k => `<option value="${k}">${k}</option>`).join('')}
              </select>
            </label>
            <label>operand JSON
              <textarea class="aoc-author-operand" rows="3" placeholder='{"property_type":"name","value":"..."}'></textarea>
            </label>
            <label>rationale
              <input class="aoc-author-rationale" type="text" placeholder="why this DEF">
            </label>
            <label>valid_from
              <input class="aoc-author-validfrom" type="text" value="${new Date().toISOString()}">
            </label>
            <button class="aoc-author-submit">Append DEF</button>
            <div class="aoc-author-status"></div>
          </div>
        </footer>
      </div>
    `;

    // Wire author affordance.
    const toggle = panelEl.querySelector('[data-author-toggle]');
    const form = panelEl.querySelector('.aoc-author-form');
    if (toggle && form) {
      toggle.addEventListener('click', () => {
        const open = !form.hasAttribute('hidden');
        if (open) form.setAttribute('hidden', '');
        else form.removeAttribute('hidden');
      });
    }
    const submit = panelEl.querySelector('.aoc-author-submit');
    if (submit) {
      submit.addEventListener('click', async () => {
        const status = panelEl.querySelector('.aoc-author-status');
        const kind = panelEl.querySelector('.aoc-author-kind').value;
        const operandText = panelEl.querySelector('.aoc-author-operand').value;
        const rationale = panelEl.querySelector('.aoc-author-rationale').value;
        const validFrom = panelEl.querySelector('.aoc-author-validfrom').value;
        let operand;
        try { operand = JSON.parse(operandText); }
        catch (e) { status.textContent = 'Operand JSON parse error: ' + e.message; return; }
        try {
          await deps.appendDefEvent({
            target: aid,
            kind,
            operand,
            rationale,
            cursors: {
              valid_from: validFrom,
              asserted_at: new Date().toISOString(),
              ingested_at: new Date().toISOString()
            },
            agent: (deps.currentUser && deps.currentUser()) || 'human:user'
          });
          status.textContent = 'DEF appended.';
          panelEl.querySelector('.aoc-author-operand').value = '';
          panelEl.querySelector('.aoc-author-rationale').value = '';
        } catch (e) {
          status.textContent = 'Append failed: ' + e.message;
        }
      });
    }
  }

  function renderKindSection(aid, kind, perKind, horizon) {
    if (!perKind || !Object.keys(perKind.buckets || {}).length) {
      return `<section class="aoc-kind aoc-kind-empty">
        <h3>${escapeHtml(kind)}</h3>
        <div class="aoc-kind-empty-msg">No DEFs of this kind.</div>
      </section>`;
    }
    const buckets = perKind.buckets;
    const stacks = perKind.stacks;
    const bucketHtml = Object.keys(buckets).map(opKey => {
      const r = buckets[opKey];
      const stack = stacks[opKey] || [];
      const winnerId = r.winner ? r.winner.id : null;
      const events = stack.map(evt => {
        const isWinner = evt.id === winnerId;
        const opSummary = operandSummary(kind, evt.operand);
        return `<div class="aoc-def-event ${isWinner ? 'aoc-def-winner' : ''}">
          <div class="aoc-def-row">
            <span class="aoc-def-marker">${isWinner ? '●' : '○'}</span>
            <span class="aoc-def-operand">${opSummary}</span>
            <span class="aoc-def-agent">${escapeHtml(evt.agent || '')}</span>
          </div>
          <div class="aoc-def-cursors">
            <span>valid_from: ${fmtCursor(evt.cursors && evt.cursors.valid_from)}</span>
            <span>asserted_at: ${fmtCursor(evt.cursors && evt.cursors.asserted_at)}</span>
            <span>observed_at: ${fmtCursor(evt.cursors && evt.cursors.observed_at)}</span>
          </div>
          ${evt.rationale ? `<div class="aoc-def-rationale">${escapeHtml(evt.rationale)}</div>` : ''}
          <div class="aoc-def-id" title="${escapeHtml(evt.id)}">${escapeHtml(evt.id.slice(0, 18))}…</div>
        </div>`;
      }).join('');
      return `<div class="aoc-bucket">
        <div class="aoc-bucket-head">
          <span class="aoc-bucket-key">${escapeHtml(opKey)}</span>
          <span class="aoc-bucket-sigma">${escapeHtml(explainSigma(horizon, kind, r))}</span>
        </div>
        <div class="aoc-bucket-stack">${events}</div>
      </div>`;
    }).join('');
    return `<section class="aoc-kind">
      <h3>${escapeHtml(kind)}</h3>
      ${bucketHtml}
    </section>`;
  }

  // ---------------------------------------------------------------
  // mount — wire the panel UI into a host element.
  //
  // Host element should contain:
  //   .aoc-anchor-list     — left rail
  //   .aoc-cursor-panel    — right pane
  //   .aoc-horizon-select  — horizon switcher
  //   .aoc-comparative-toggle — comparative override checkbox
  //   .aoc-load-eo         — file input for .eo open
  //   .aoc-save-eo         — button to download current log
  //   .aoc-status          — status line
  //
  // mount returns a refresh() function the caller invokes after any
  // event append, file load, or horizon change.
  // ---------------------------------------------------------------
  function mount(rootEl, deps) {
    if (!rootEl) throw new Error('AnchorageCursor.mount: rootEl required');
    const listEl = rootEl.querySelector('.aoc-anchor-list');
    const panelEl = rootEl.querySelector('.aoc-cursor-panel');
    const horizonSel = rootEl.querySelector('.aoc-horizon-select');
    const compToggle = rootEl.querySelector('.aoc-comparative-toggle');
    const statusEl = rootEl.querySelector('.aoc-status');

    let selectedAid = null;

    function refresh() {
      const projection = deps.getProjection();
      renderAnchorList(listEl, projection);
      // Re-bind anchor row clicks.
      listEl.querySelectorAll('.aoc-anchor-row').forEach(row => {
        row.addEventListener('click', () => {
          selectedAid = row.dataset.aid;
          listEl.querySelectorAll('.aoc-anchor-row.is-selected').forEach(r => r.classList.remove('is-selected'));
          row.classList.add('is-selected');
          renderCursor(panelEl, selectedAid, projection, deps);
        });
      });
      if (selectedAid) renderCursor(panelEl, selectedAid, projection, deps);
      else panelEl.innerHTML = '<div class="aoc-empty">Select an anchor on the left.</div>';

      if (statusEl) {
        const horizonName = (deps.getActiveHorizon() || {}).name || '?';
        statusEl.textContent = `${(projection.anchors ? Object.keys(projection.anchors).length : 0)} anchors · ${projection.defCount} DEFs · ${projection.observationCount} obs · σ=${horizonName}`;
      }
    }

    // Horizon switcher.
    if (horizonSel) {
      const built = global.AnchorageFold.builtinHorizons;
      horizonSel.innerHTML = Object.keys(built).map(name =>
        `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
      ).join('');
      horizonSel.addEventListener('change', () => {
        const h = built[horizonSel.value] || built.latest;
        deps.setActiveHorizon(h);
        refresh();
      });
    }

    // Comparative override — toggles between current Horizon and `comparative`.
    if (compToggle) {
      compToggle.addEventListener('change', () => {
        const built = global.AnchorageFold.builtinHorizons;
        if (compToggle.checked) {
          deps._priorHorizon = deps.getActiveHorizon();
          deps.setActiveHorizon(built.comparative);
        } else {
          deps.setActiveHorizon(deps._priorHorizon || built.latest);
        }
        if (horizonSel) horizonSel.value = (deps.getActiveHorizon() || {}).name || 'latest';
        refresh();
      });
    }

    return { refresh, selectAnchor: (aid) => { selectedAid = aid; refresh(); } };
  }

  global.AnchorageCursor = { mount, renderAnchorList, renderCursor };
})(typeof window !== 'undefined' ? window : globalThis);
