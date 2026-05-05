/* ===========================================================================
   ANCHORAGE — opt-in analytical views
   ---------------------------------------------------------------------------
   Per spec these are accessible, named, and documented but not on the
   primary path. The default user — domain practitioner — never sees them
   unless they go looking.

     Structural — full 3D address (mode × domain × object). The cube exists,
                  this is where it lives. Rendered as a stack of (domain ×
                  object) slabs, one per mode.
     Discourse  — Act-face heatmap (mode × domain). For analyzing the
                  discourse of the corpus — heavy INS means lots of new
                  entities introduced; heavy REC means lots of paradigm work.
     Resolution — Resolution-face (mode × object). For cross-linguistic
                  research and empirical-validation work.

   All three read the corpus's observation phasepost histogram. The cube
   is the math; these are three projections of it onto a flat surface.

   Public surface:
     AnchorageViews.renderStructural(canvasEl, projection, state)
     AnchorageViews.renderDiscourse(canvasEl, projection, state)
     AnchorageViews.renderResolution(canvasEl, projection, state)
============================================================================ */

(function (global) {
  'use strict';

  const MODES = ['sig', 'ins', 'con', 'def', 'eva', 'nul'];
  const DOMAINS = ['ground', 'particular', 'pattern'];
  const OBJECTS = ['existence', 'structure', 'significance'];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);
  }

  // -------------------------------------------------------------
  // Build an observation-phasepost histogram once; the three views
  // project it differently. Returns a 3-axis tensor keyed by string
  // tuples for direct lookup, plus a flat list of cells with counts
  // and the anchors that contribute.
  // -------------------------------------------------------------
  function tensorFromProjection(projection) {
    const cube = Object.create(null);
    const anchorsBySite = Object.create(null); // aid -> {dominant terrain key}
    const T = global.AnchorageTerrains;
    const obsByAnchor = projection.observationsByAnchor || {};
    let total = 0;
    for (const aid of Object.keys(obsByAnchor)) {
      const t = T.dominantTerrain((projection.cellPopulations || {})[aid] || {});
      anchorsBySite[aid] = t ? t.key : null;
      for (const obs of obsByAnchor[aid]) {
        const pp = Array.isArray(obs.phasepost) ? obs.phasepost : null;
        if (!pp || pp.length !== 3) continue;
        const [m, d, o] = pp;
        const k = m + '|' + d + '|' + o;
        cube[k] = (cube[k] || 0) + 1;
        total++;
      }
    }
    return { cube, total, anchorsBySite };
  }

  function pctColor(pct) {
    // Sienna ramp matching the panel's accent.
    const intensity = Math.min(1, pct);
    const alpha = (0.06 + intensity * 0.85).toFixed(3);
    return 'rgba(184, 122, 61, ' + alpha + ')';
  }

  // -------------------------------------------------------------
  // Structural — full address. Six (domain × object) slabs stacked
  // vertically, one per mode. Empty cells render as visible dashed
  // outlines per the same "absence is data" convention as the rail.
  // -------------------------------------------------------------
  function renderStructural(canvasEl, projection) {
    if (!canvasEl) return;
    const { cube, total } = tensorFromProjection(projection);
    const slabHtml = MODES.map(mode => {
      const rows = DOMAINS.map(domain => {
        const cells = OBJECTS.map(object => {
          const key = mode + '|' + domain + '|' + object;
          const n = cube[key] || 0;
          const pct = total ? n / total : 0;
          const empty = n === 0;
          return `<div class="aoc-cube-cell ${empty ? 'is-empty' : ''}"
                       style="background:${empty ? 'transparent' : pctColor(pct * 6)}"
                       title="[${escapeHtml(mode)},${escapeHtml(domain)},${escapeHtml(object)}] · ${n}">
                    <span class="aoc-cube-count">${n}</span>
                  </div>`;
        }).join('');
        return `<div class="aoc-cube-row" data-domain="${domain}">
                  <span class="aoc-cube-rowlabel">${escapeHtml(domain)}</span>${cells}
                </div>`;
      }).join('');
      return `<div class="aoc-cube-slab" data-mode="${mode}">
                <div class="aoc-cube-slab-head">
                  <span class="aoc-cube-mode">${escapeHtml(mode)}</span>
                  <span class="aoc-cube-axes">existence · structure · significance</span>
                </div>
                ${rows}
              </div>`;
    }).join('');
    canvasEl.innerHTML = `
      <div class="aoc-cube">
        <div class="aoc-cube-head">
          <h3>Structural — full address</h3>
          <p>Each slab is one mode; rows are domain (ground / particular / pattern); cells are object (existence / structure / significance).</p>
          <p class="aoc-cube-meta">${total} observations across ${MODES.length} × ${DOMAINS.length} × ${OBJECTS.length} = 54 cells.</p>
        </div>
        ${slabHtml}
      </div>`;
  }

  // -------------------------------------------------------------
  // Discourse — Mode × Domain heatmap.
  // Aggregates over the object axis.
  // -------------------------------------------------------------
  function renderDiscourse(canvasEl, projection) {
    if (!canvasEl) return;
    const { cube, total } = tensorFromProjection(projection);
    // Sum over OBJECT.
    const grid = Object.create(null);
    for (const m of MODES) for (const d of DOMAINS) {
      let s = 0;
      for (const o of OBJECTS) s += cube[m + '|' + d + '|' + o] || 0;
      grid[m + '|' + d] = s;
    }
    canvasEl.innerHTML = `
      <div class="aoc-heatmap">
        <div class="aoc-heatmap-head">
          <h3>Discourse — Mode × Domain</h3>
          <p>What the corpus is doing: heavy <code>ins</code> = many anchors introduced; heavy <code>eva</code> = many evaluations against existing definitions; heavy <code>nul</code> = many recorded absences.</p>
          <p class="aoc-cube-meta">${total} observations.</p>
        </div>
        <table class="aoc-heatmap-grid">
          <thead><tr><th></th>${DOMAINS.map(d => `<th>${escapeHtml(d)}</th>`).join('')}</tr></thead>
          <tbody>
            ${MODES.map(m => `<tr>
              <th class="aoc-heatmap-rowhead">${escapeHtml(m)}</th>
              ${DOMAINS.map(d => {
                const n = grid[m + '|' + d];
                const pct = total ? n / total : 0;
                const empty = n === 0;
                return `<td class="aoc-heatmap-cell ${empty ? 'is-empty' : ''}"
                           style="background:${empty ? 'transparent' : pctColor(pct * 4)}"
                           title="${escapeHtml(m)} × ${escapeHtml(d)} · ${n}">${n}</td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // -------------------------------------------------------------
  // Resolution — Mode × Object heatmap. Aggregates over domain.
  // -------------------------------------------------------------
  function renderResolution(canvasEl, projection) {
    if (!canvasEl) return;
    const { cube, total } = tensorFromProjection(projection);
    const grid = Object.create(null);
    for (const m of MODES) for (const o of OBJECTS) {
      let s = 0;
      for (const d of DOMAINS) s += cube[m + '|' + d + '|' + o] || 0;
      grid[m + '|' + o] = s;
    }
    canvasEl.innerHTML = `
      <div class="aoc-heatmap">
        <div class="aoc-heatmap-head">
          <h3>Resolution — Mode × Object</h3>
          <p>Cross-linguistic / empirical surface: which kinds of objects (existence vs structure vs significance) get worked at in which mode. Heavy <code>def × significance</code> = lots of framing work.</p>
          <p class="aoc-cube-meta">${total} observations.</p>
        </div>
        <table class="aoc-heatmap-grid">
          <thead><tr><th></th>${OBJECTS.map(o => `<th>${escapeHtml(o)}</th>`).join('')}</tr></thead>
          <tbody>
            ${MODES.map(m => `<tr>
              <th class="aoc-heatmap-rowhead">${escapeHtml(m)}</th>
              ${OBJECTS.map(o => {
                const n = grid[m + '|' + o];
                const pct = total ? n / total : 0;
                const empty = n === 0;
                return `<td class="aoc-heatmap-cell ${empty ? 'is-empty' : ''}"
                           style="background:${empty ? 'transparent' : pctColor(pct * 4)}"
                           title="${escapeHtml(m)} × ${escapeHtml(o)} · ${n}">${n}</td>`;
              }).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  global.AnchorageViews = {
    renderStructural,
    renderDiscourse,
    renderResolution
  };
})(typeof window !== 'undefined' ? window : globalThis);
