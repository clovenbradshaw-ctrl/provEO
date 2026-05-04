/* ===========================================================================
   ANCHORAGE — Site-organized graph UI
   ---------------------------------------------------------------------------
   Replaces the prior cursor-table layout. Site face (3×3 terrain grid) is
   the primary navigation; graph canvas is the main work surface; anchor
   detail panel exposes the live projection plus authoring affordance.

   The cube is the math, the nine terrains are the interface, the graph is
   where the work happens.

   The substrate is unchanged — same fold output drives the new presentation.

   Public surface:
     AnchorageCursor.mount(rootEl, deps)
       deps = { getProjection, getEvents, getActiveHorizon,
                setActiveHorizon, appendDefEvent, currentUser }
       returns { refresh, selectAnchor }

   The host markup (index.html) provides this skeleton inside #mode-anchorage:
     .aoc-toolbar           — pre-existing horizontal toolbar
     .aoc-shell             — main 3-column layout (terrains | canvas | detail)
       .aoc-terrain-rail
       .aoc-canvas
       .aoc-detail
     .aoc-view-toggle       — bottom view switcher

   Cytoscape is loaded from a CDN by index.html as a classic script. If the
   global is missing the canvas falls back to a Tabular-only mode so the
   panel stays usable offline-ish.
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

  // -------------------------------------------------------------
  // Terrain rail — left column.
  //
  // Renders the 3×3 Site face with anchor counts and density bars.
  // Click filters the canvas to anchors whose dominant terrain is
  // that cell. Shift-click adds; right-click excludes. Empty cells
  // render as dashed outlines — absence is data per spec.
  // -------------------------------------------------------------
  function renderTerrainRail(railEl, projection, state) {
    if (!railEl) return;
    const counts = global.AnchorageTerrains.corpusTerrainCounts(projection);
    const max = Math.max(1, ...Object.values(counts));
    const T = global.AnchorageTerrains;

    const cellHtml = (terrain) => {
      const n = counts[terrain.key] || 0;
      const pct = Math.round((n / max) * 100);
      const filtered = state.terrainFilter.has(terrain.key);
      const excluded = state.terrainExclude.has(terrain.key);
      const empty = n === 0;
      return `
        <button class="aoc-tcell ${empty ? 'is-empty' : ''} ${filtered ? 'is-active' : ''} ${excluded ? 'is-excluded' : ''}"
                data-terrain="${terrain.key}"
                title="${escapeHtml(terrain.name + ' — ' + terrain.blurb)}">
          <span class="aoc-tcell-name">${escapeHtml(terrain.short)}</span>
          <span class="aoc-tcell-count">${n}</span>
          <span class="aoc-tcell-bar"><span class="aoc-tcell-fill" style="width:${pct}%"></span></span>
        </button>`;
    };

    const rows = T.GRID_ROWS.map(domain => {
      const rowCells = T.GRID_COLS.map(object => {
        const t = T.byKey(domain, object);
        return cellHtml(t);
      }).join('');
      return `<div class="aoc-trow" data-row="${domain}">
        <span class="aoc-trow-label">${escapeHtml(domain)}</span>
        ${rowCells}
      </div>`;
    }).join('');

    railEl.innerHTML = `
      <div class="aoc-rail-head">
        <div class="aoc-rail-title">TERRAINS</div>
        <div class="aoc-rail-axes">
          <span class="aoc-rail-axis">Existence</span>
          <span class="aoc-rail-axis">Structure</span>
          <span class="aoc-rail-axis">Significance</span>
        </div>
      </div>
      <div class="aoc-tgrid">
        ${rows}
      </div>
      <div class="aoc-rail-foot">
        <button class="aoc-rail-clear" type="button">clear filters</button>
      </div>
    `;

    // Click bindings.
    railEl.querySelectorAll('.aoc-tcell').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const k = btn.dataset.terrain;
        if (e.shiftKey) {
          if (state.terrainFilter.has(k)) state.terrainFilter.delete(k);
          else state.terrainFilter.add(k);
        } else {
          state.terrainFilter.clear();
          state.terrainFilter.add(k);
        }
        state.terrainExclude.delete(k);
        state.refresh();
      });
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const k = btn.dataset.terrain;
        if (state.terrainExclude.has(k)) state.terrainExclude.delete(k);
        else state.terrainExclude.add(k);
        state.terrainFilter.delete(k);
        state.refresh();
      });
    });
    const clearBtn = railEl.querySelector('.aoc-rail-clear');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      state.terrainFilter.clear();
      state.terrainExclude.clear();
      state.refresh();
    });
  }

  // -------------------------------------------------------------
  // Anchor selection — derive the visible anchor set from terrain
  // filters plus full-text search. Used by both the graph and the
  // tabular view so they stay in sync.
  // -------------------------------------------------------------
  function visibleAnchors(projection, state) {
    const T = global.AnchorageTerrains;
    const out = [];
    for (const aid of Object.keys(projection.anchors || {})) {
      const cells = (projection.cellPopulations || {})[aid] || {};
      const dominant = T.dominantTerrain(cells);
      const dKey = dominant ? dominant.key : null;
      if (state.terrainExclude.size && dKey && state.terrainExclude.has(dKey)) continue;
      if (state.terrainFilter.size && (!dKey || !state.terrainFilter.has(dKey))) continue;
      if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase();
        if (!aid.toLowerCase().includes(q)) continue;
      }
      out.push({
        aid,
        anchor: projection.anchors[aid],
        cells,
        dominant
      });
    }
    out.sort((a, b) => a.aid.localeCompare(b.aid));
    return out;
  }

  // -------------------------------------------------------------
  // Graph canvas — Cytoscape if present, otherwise a fallback list.
  //
  // Nodes: anchors. Color by terrain row. Shape by terrain column
  // (existence=ellipse, structure=triangle, significance=diamond).
  // Edges: relation DEFs (kind='relation'); operator dictates style.
  // -------------------------------------------------------------
  function buildGraphElements(projection, state) {
    const T = global.AnchorageTerrains;
    const visible = visibleAnchors(projection, state);
    const visibleIds = new Set(visible.map(v => v.aid));
    const nodes = visible.map(v => {
      const t = v.dominant;
      const obsCount = Object.values(v.cells).reduce((s, n) => s + n, 0);
      return {
        data: {
          id: v.aid,
          label: v.aid.replace(/^ent:/, ''),
          terrainKey: t ? t.key : 'void',
          terrainRow: t ? t.domain : 'ground',
          terrainObject: t ? t.object : 'existence',
          color: T.colorOf(t),
          obs: obsCount
        }
      };
    });
    const edges = [];
    const stacks = projection.defStacks || {};
    for (const aid of Object.keys(stacks)) {
      const rel = stacks[aid].relation;
      if (!rel) continue;
      for (const opKey of Object.keys(rel)) {
        const stack = rel[opKey];
        if (!stack || !stack.length) continue;
        const last = stack[stack.length - 1];
        const operand = last.operand || {};
        const op = operand.operator || 'REL';
        const targets = Array.isArray(operand.targets) ? operand.targets : [];
        for (const tgt of targets) {
          if (tgt === aid) continue;
          if (!visibleIds.has(aid) || !visibleIds.has(tgt)) continue;
          edges.push({
            data: {
              id: aid + '→' + tgt + ':' + op,
              source: aid, target: tgt, op,
              weight: Math.max(1, stack.length)
            }
          });
        }
      }
    }
    return { nodes, edges };
  }

  function renderGraph(canvasEl, projection, state) {
    if (!canvasEl) return;
    const { nodes, edges } = buildGraphElements(projection, state);
    const cyAvailable = !!global.cytoscape;

    if (!cyAvailable) {
      canvasEl.innerHTML =
        `<div class="aoc-canvas-fallback">
           <div>Cytoscape not loaded — falling back to list. ${nodes.length} anchors visible.</div>
           <ul class="aoc-graph-fallback-list">
             ${nodes.map(n =>
               `<li><button data-aid="${escapeHtml(n.data.id)}" style="color:${n.data.color}">●</button>
                    <code>${escapeHtml(n.data.label)}</code>
                    <span>${n.data.obs} obs</span></li>`
             ).join('')}
           </ul>
         </div>`;
      canvasEl.querySelectorAll('button[data-aid]').forEach(btn => {
        btn.addEventListener('click', () => state.selectAnchor(btn.dataset.aid));
      });
      return;
    }

    // Container for Cytoscape — needs an explicit element.
    canvasEl.innerHTML = `<div class="aoc-cy" style="width:100%;height:100%;"></div>
                          <div class="aoc-canvas-meta"><span>${nodes.length} anchors · ${edges.length} relations</span></div>
                          <div class="aoc-graph-legend">
                            <span><span class="aoc-glyph aoc-glyph-existence"></span>Existence</span>
                            <span><span class="aoc-glyph aoc-glyph-structure"></span>Structure</span>
                            <span><span class="aoc-glyph aoc-glyph-significance"></span>Significance</span>
                          </div>`;
    const cyContainer = canvasEl.querySelector('.aoc-cy');

    // Tear down any prior cy instance to avoid leaks on refresh.
    if (state._cy) { try { state._cy.destroy(); } catch (e) {} state._cy = null; }
    const cy = global.cytoscape({
      container: cyContainer,
      elements: { nodes, edges },
      wheelSensitivity: 0.2,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'border-color': '#3a3530',
            'border-width': 0.5,
            'label': 'data(label)',
            'color': '#3a3530',
            'font-size': 9,
            'font-family': 'ui-monospace, monospace',
            'text-valign': 'center',
            'text-halign': 'right',
            'text-margin-x': 6,
            'width': 'mapData(obs, 0, 50, 16, 36)',
            'height': 'mapData(obs, 0, 50, 16, 36)',
            'shape': 'ellipse'
          }
        },
        { selector: 'node[terrainObject="structure"]',    style: { 'shape': 'triangle' } },
        { selector: 'node[terrainObject="significance"]', style: { 'shape': 'diamond' } },
        {
          selector: 'edge',
          style: {
            'curve-style': 'bezier',
            'width': 'mapData(weight, 1, 10, 1, 4)',
            'line-color': '#968b78',
            'target-arrow-color': '#968b78',
            'target-arrow-shape': 'triangle',
            'opacity': 0.7
          }
        },
        { selector: 'edge[op="SEG"]',  style: { 'line-style': 'dashed' } },
        { selector: 'edge[op="SYN"]',  style: { 'line-style': 'dotted' } },
        {
          selector: 'node:selected',
          style: { 'border-color': '#b87a3d', 'border-width': 2 }
        }
      ],
      layout: { name: 'cose', animate: false, padding: 20 }
    });
    cy.on('tap', 'node', (evt) => {
      state.selectAnchor(evt.target.id());
    });
    state._cy = cy;
  }

  // -------------------------------------------------------------
  // Tabular view — the demoted default. One row per visible anchor;
  // click selects.
  // -------------------------------------------------------------
  function renderTabular(canvasEl, projection, state) {
    if (!canvasEl) return;
    const visible = visibleAnchors(projection, state);
    const rows = visible.map(v => {
      const obs = Object.values(v.cells).reduce((s, n) => s + n, 0);
      const stacks = projection.defStacks[v.aid] || {};
      const defCount = Object.values(stacks)
        .reduce((s, kindMap) => s + Object.values(kindMap)
          .reduce((s2, stack) => s2 + stack.length, 0), 0);
      const tName = v.dominant ? v.dominant.name : '—';
      const cell = (() => {
        const top = Object.entries(v.cells).sort((a, b) => b[1] - a[1])[0];
        return top ? top[0] : '—';
      })();
      return `<tr data-aid="${escapeHtml(v.aid)}">
        <td><code>${escapeHtml(v.aid)}</code></td>
        <td>${escapeHtml(tName)}</td>
        <td><code>${escapeHtml(cell)}</code></td>
        <td class="aoc-num">${obs}</td>
        <td class="aoc-num">${defCount}</td>
      </tr>`;
    }).join('');
    canvasEl.innerHTML = `
      <table class="aoc-table">
        <thead><tr>
          <th>Anchor</th><th>Terrain</th><th>Cell</th><th>Obs</th><th>DEFs</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="aoc-empty">No anchors match the current filters.</td></tr>'}</tbody>
      </table>`;
    canvasEl.querySelectorAll('tr[data-aid]').forEach(tr => {
      tr.addEventListener('click', () => state.selectAnchor(tr.dataset.aid));
    });
  }

  function renderDeferred(canvasEl, viewName) {
    canvasEl.innerHTML = `
      <div class="aoc-deferred">
        <div class="aoc-deferred-glyph">◇</div>
        <h3>${escapeHtml(viewName)} view</h3>
        <p>This analytical workspace is part of the Anchorage spec but has not landed in this build. It will surface the ${escapeHtml(viewName.toLowerCase())} face of the EO cube as an opt-in workspace.</p>
        <p class="aoc-deferred-note">The substrate already addresses every cell — only the visualization is pending.</p>
      </div>`;
  }

  // -------------------------------------------------------------
  // Detail panel — right rail.
  // -------------------------------------------------------------
  function renderDetail(detailEl, aid, projection, deps, state) {
    if (!detailEl) return;
    if (!aid) {
      detailEl.innerHTML = '<div class="aoc-empty">Select an anchor.</div>';
      return;
    }
    const anchor = (projection.anchors || {})[aid];
    if (!anchor) {
      detailEl.innerHTML = `<div class="aoc-empty">Unknown anchor: ${escapeHtml(aid)}</div>`;
      return;
    }
    const T = global.AnchorageTerrains;
    const horizon = (deps && deps.getActiveHorizon && deps.getActiveHorizon())
      || global.AnchorageFold.builtinHorizons.latest;
    const perAnchor = (projection.projections || {})[aid] || {};
    const cells = (projection.cellPopulations || {})[aid] || {};
    const cellTotal = Object.values(cells).reduce((s, n) => s + n, 0);
    const dominant = T.dominantTerrain(cells);
    const cellList = Object.entries(cells).sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `<span class="aoc-cell">${escapeHtml(c)}<span class="aoc-cell-n">×${n}</span></span>`).join('');
    const observations = (projection.observationsByAnchor || {})[aid] || [];

    // Mode distribution — kept collapsed by default per spec.
    const modeCounts = Object.create(null);
    for (const obs of observations) {
      const m = Array.isArray(obs.phasepost) ? obs.phasepost[0] : 'unknown';
      modeCounts[m] = (modeCounts[m] || 0) + 1;
    }

    // Group sections.
    const classificationHtml = renderKindSection(aid, 'classification', perAnchor.classification, horizon);
    const propertyHtml = renderKindSection(aid, 'property', perAnchor.property, horizon);
    const relationHtml = renderKindSection(aid, 'relation', perAnchor.relation, horizon);
    const scopeHtml = renderKindSection(aid, 'scope', perAnchor.scope, horizon);
    const lensHtml = renderLensSection(aid, perAnchor.lens, horizon);

    const obsHtml = observations.slice(0, 6).map(obs => `
      <div class="aoc-source-clause">
        <div class="aoc-source-loc">${escapeHtml(obs.src)}</div>
        <div class="aoc-source-text">${escapeHtml(obs.clause || obs.G || '')}</div>
      </div>`).join('');

    detailEl.innerHTML = `
      <header class="aoc-detail-head">
        <div class="aoc-detail-aid">${escapeHtml(aid)}</div>
        <div class="aoc-detail-meta">
          ${dominant ? `<span class="aoc-terrain-badge" style="background:${T.colorOf(dominant)}">${escapeHtml(dominant.name)}</span>` : ''}
          <span class="aoc-detail-cells">${cellTotal} obs · first_seen ${escapeHtml(anchor.first_seen || '—')}</span>
        </div>
        <details class="aoc-mode">
          <summary>Mode distribution</summary>
          <div class="aoc-mode-list">
            ${Object.entries(modeCounts).map(([m, n]) => `<span class="aoc-mode-pill"><b>${escapeHtml(m)}</b> ${n}</span>`).join('') || '<em class="aoc-na">no observations</em>'}
          </div>
        </details>
      </header>

      <section class="aoc-section">
        <h4>LIVE PROJECTION</h4>
        ${classificationHtml}${propertyHtml}${relationHtml}${scopeHtml}
      </section>

      <section class="aoc-section">
        <h4>LENS DEFs</h4>
        ${lensHtml}
      </section>

      <section class="aoc-section">
        <h4>SOURCE CLAUSES (${observations.length})</h4>
        <div class="aoc-source-list">
          ${obsHtml || '<em class="aoc-na">no observations linked to this anchor</em>'}
          ${observations.length > 6 ? `<button class="aoc-source-more">show all ${observations.length}</button>` : ''}
        </div>
      </section>

      <footer class="aoc-detail-foot">
        <button class="aoc-author-toggle" data-author-toggle>+ Add DEF</button>
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
          <button class="aoc-author-submit">Append</button>
          <div class="aoc-author-status"></div>
        </div>
      </footer>
    `;

    // Authoring affordance.
    const toggle = detailEl.querySelector('[data-author-toggle]');
    const form = detailEl.querySelector('.aoc-author-form');
    if (toggle && form) {
      toggle.addEventListener('click', () => {
        const open = !form.hasAttribute('hidden');
        if (open) form.setAttribute('hidden', '');
        else form.removeAttribute('hidden');
      });
    }
    const submit = detailEl.querySelector('.aoc-author-submit');
    if (submit) {
      submit.addEventListener('click', async () => {
        const status = detailEl.querySelector('.aoc-author-status');
        const kind = detailEl.querySelector('.aoc-author-kind').value;
        const operandText = detailEl.querySelector('.aoc-author-operand').value;
        const rationale = detailEl.querySelector('.aoc-author-rationale').value;
        const validFrom = detailEl.querySelector('.aoc-author-validfrom').value;
        let operand;
        try { operand = JSON.parse(operandText); }
        catch (e) { status.textContent = 'Operand JSON parse error: ' + e.message; return; }
        try {
          await deps.appendDefEvent({
            target: aid, kind, operand, rationale,
            cursors: {
              valid_from: validFrom,
              asserted_at: new Date().toISOString(),
              ingested_at: new Date().toISOString()
            },
            agent: (deps.currentUser && deps.currentUser()) || 'human:user'
          });
          status.textContent = 'DEF appended.';
          detailEl.querySelector('.aoc-author-operand').value = '';
          detailEl.querySelector('.aoc-author-rationale').value = '';
        } catch (e) {
          status.textContent = 'Append failed: ' + e.message;
        }
      });
    }
  }

  function renderKindSection(aid, kind, perKind, horizon) {
    if (!perKind || !Object.keys(perKind.buckets || {}).length) {
      return `<div class="aoc-kind aoc-kind-empty">
        <div class="aoc-kind-name">${escapeHtml(kind)}</div>
        <div class="aoc-kind-empty-msg">no DEFs of this kind</div>
      </div>`;
    }
    const blocks = Object.keys(perKind.buckets).map(opKey => {
      const r = perKind.buckets[opKey];
      const stack = perKind.stacks[opKey] || [];
      const winnerId = r.winner ? r.winner.id : null;
      const summary = r.winner ? operandSummary(kind, r.winner.operand) : '<em>no winner</em>';
      const events = stack.map(evt => {
        const isWinner = evt.id === winnerId;
        return `<div class="aoc-def-event ${isWinner ? 'is-winner' : ''}">
          <div class="aoc-def-row">
            <span class="aoc-def-marker">${isWinner ? '●' : '○'}</span>
            <span class="aoc-def-operand">${operandSummary(kind, evt.operand)}</span>
            <span class="aoc-def-agent">${escapeHtml(evt.agent || '')}</span>
          </div>
          <div class="aoc-def-cursors">
            <span>asserted ${fmtCursor(evt.cursors && evt.cursors.asserted_at)}</span>
          </div>
          ${evt.rationale ? `<div class="aoc-def-rationale">${escapeHtml(evt.rationale)}</div>` : ''}
        </div>`;
      }).join('');
      return `<details class="aoc-bucket">
        <summary class="aoc-bucket-summary">
          <span class="aoc-bucket-key">${escapeHtml(opKey.replace(/^[^:]+:/, ''))}</span>
          <span class="aoc-bucket-value">${summary}</span>
          <span class="aoc-bucket-count">${stack.length} DEF${stack.length === 1 ? '' : 's'}</span>
        </summary>
        <div class="aoc-bucket-explain">${escapeHtml(explainSigma(horizon, kind, r))}</div>
        <div class="aoc-bucket-stack">${events}</div>
      </details>`;
    }).join('');
    return `<div class="aoc-kind">
      <div class="aoc-kind-name">${escapeHtml(kind)}</div>
      ${blocks}
    </div>`;
  }

  function renderLensSection(aid, perKind, horizon) {
    if (!perKind || !Object.keys(perKind.buckets || {}).length) {
      return `<div class="aoc-lens-empty">
        No Lens commitments yet — author one with <b>+ Add DEF</b> (kind=lens).
      </div>`;
    }
    const buckets = perKind.buckets;
    const stacks = perKind.stacks;
    const blocks = Object.keys(buckets).map(opKey => {
      const r = buckets[opKey];
      const stack = stacks[opKey] || [];
      const last = r.winner || stack[stack.length - 1];
      const operand = (last && last.operand) || {};
      const fwk = operand.framework || opKey.replace(/^lens:/, '');
      return `<div class="aoc-lens-row">
        <div class="aoc-lens-fwk">framework: ${escapeHtml(fwk)}</div>
        <div class="aoc-lens-body">${escapeHtml(operand.category || '')}${operand.subcategory ? ' · ' + escapeHtml(operand.subcategory) : ''}</div>
        <div class="aoc-lens-meta">${escapeHtml(explainSigma(horizon, 'lens', r))}</div>
      </div>`;
    }).join('');
    return `<div class="aoc-lens-list">${blocks}</div>`;
  }

  // -------------------------------------------------------------
  // Mount.
  // -------------------------------------------------------------
  function mount(rootEl, deps) {
    if (!rootEl) throw new Error('AnchorageCursor.mount: rootEl required');

    const railEl = rootEl.querySelector('.aoc-terrain-rail');
    const canvasEl = rootEl.querySelector('.aoc-canvas');
    const detailEl = rootEl.querySelector('.aoc-detail');
    const statusEl = rootEl.querySelector('.aoc-status');
    const horizonSel = rootEl.querySelector('.aoc-horizon-select');
    const compToggle = rootEl.querySelector('.aoc-comparative-toggle');
    const viewToggleEl = rootEl.querySelector('.aoc-view-toggle');
    const searchEl = rootEl.querySelector('.aoc-search');

    const state = {
      view: 'graph',                   // graph | tabular | structural | discourse | resolution
      terrainFilter: new Set(),
      terrainExclude: new Set(),
      searchQuery: '',
      selectedAid: null,
      _cy: null,
      refresh,
      selectAnchor(aid) {
        state.selectedAid = aid;
        renderDetail(detailEl, aid, deps.getProjection(), deps, state);
        // Reflect selection on the graph if cytoscape is up.
        if (state._cy) {
          state._cy.elements().unselect();
          const node = state._cy.getElementById(aid);
          if (node && node.length) node.select();
        }
      }
    };

    function refresh() {
      const projection = deps.getProjection();
      renderTerrainRail(railEl, projection, state);
      renderCenter(canvasEl, projection, state);
      renderDetail(detailEl, state.selectedAid, projection, deps, state);
      if (statusEl) {
        const horizonName = (deps.getActiveHorizon() || {}).name || '?';
        const total = projection.anchors ? Object.keys(projection.anchors).length : 0;
        statusEl.textContent = `${total} anchors · ${projection.defCount} DEFs · ${projection.observationCount} obs · σ=${horizonName}`;
      }
    }

    function renderCenter(el, projection, state) {
      switch (state.view) {
        case 'graph':       return renderGraph(el, projection, state);
        case 'tabular':     return renderTabular(el, projection, state);
        case 'structural':  return renderDeferred(el, 'Structural');
        case 'discourse':   return renderDeferred(el, 'Discourse');
        case 'resolution':  return renderDeferred(el, 'Resolution');
        default:            return renderGraph(el, projection, state);
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

    // View toggle.
    if (viewToggleEl) {
      viewToggleEl.querySelectorAll('[data-view]').forEach(btn => {
        btn.addEventListener('click', () => {
          state.view = btn.dataset.view;
          viewToggleEl.querySelectorAll('[data-view]').forEach(b =>
            b.classList.toggle('is-active', b === btn));
          refresh();
        });
      });
    }

    // Search input — minimal substring on aid.
    if (searchEl) {
      searchEl.addEventListener('input', () => {
        state.searchQuery = searchEl.value.trim();
        refresh();
      });
    }

    return { refresh, selectAnchor: state.selectAnchor };
  }

  global.AnchorageCursor = { mount };
})(typeof window !== 'undefined' ? window : globalThis);
