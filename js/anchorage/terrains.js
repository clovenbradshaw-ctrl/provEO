/* ===========================================================================
   ANCHORAGE — terrain map
   ---------------------------------------------------------------------------
   The Site face of the EO cube is the (domain × object) 3×3 grid. Each cell
   has a terrain name and a color. The terrain is the primary navigation
   surface in the new UI; it's a presentation concern, not a substrate one.

   Public surface:
     AnchorageTerrains.TERRAINS               — array of 9 terrain descriptors
     AnchorageTerrains.byKey(domain, object)  — terrain descriptor or null
     AnchorageTerrains.terrainOfPhasepost(pp) — terrain or null
     AnchorageTerrains.dominantTerrain(cellPopulations) — most-populated terrain
     AnchorageTerrains.GRID_ROWS              — domain order, top-to-bottom
     AnchorageTerrains.GRID_COLS              — object order, left-to-right
============================================================================ */

(function (global) {
  'use strict';

  // Row order matches the spec's left-rail layout: Ground row first
  // (atmospheric / unfocused), Particular row middle, Pattern row last
  // (categorical / abstract). Empty Ground rows render as visible
  // sparsity per spec — they're data, not absence.
  const GRID_ROWS = Object.freeze(['ground', 'particular', 'pattern']);
  const GRID_COLS = Object.freeze(['existence', 'structure', 'significance']);

  // Color palette — one shade per row, deepening from ground (light) to
  // pattern (saturated). Within a row, columns share hue but differ in
  // shape (set in the graph layer). Hex values are deliberate cream-
  // palette neighbors of the existing PROVeo tokens.
  const COLOR_BY_ROW = Object.freeze({
    ground:     '#c9b78f',  // sandy
    particular: '#b87a3d',  // sienna (matches --color-accent)
    pattern:    '#5a7a5a'   // moss
  });

  // The nine terrains. Domain is row (vertical position); object is
  // column (horizontal). `name` is the display label; `key` is the
  // internal id used in CSS classes and graph data.
  const TERRAINS = Object.freeze([
    { key: 'void',       name: 'Void',       short: 'Void', domain: 'ground',     object: 'existence',
      blurb: 'No entity given — atmospheric absence.' },
    { key: 'field',      name: 'Field',      short: 'Field', domain: 'ground',     object: 'structure',
      blurb: 'Spatial / relational ground; the structuring backdrop.' },
    { key: 'atmosphere', name: 'Atmosphere', short: 'Atm',  domain: 'ground',     object: 'significance',
      blurb: 'Unfocused atmospheric significance; mood, register, context.' },

    { key: 'entity',     name: 'Entity',     short: 'Entity', domain: 'particular', object: 'existence',
      blurb: 'A specific entity — a particular thing.' },
    { key: 'link',       name: 'Link',       short: 'Link',   domain: 'particular', object: 'structure',
      blurb: 'A specific relation between particulars.' },
    { key: 'lens',       name: 'Lens',       short: 'Lens',   domain: 'particular', object: 'significance',
      blurb: 'A specific framing or interpretive commitment.' },

    { key: 'kind',       name: 'Kind',       short: 'Kind',    domain: 'pattern',    object: 'existence',
      blurb: 'Categorical existence — types, classes, kinds.' },
    { key: 'network',    name: 'Network',    short: 'Net',     domain: 'pattern',    object: 'structure',
      blurb: 'Categorical relations — recurring structural motifs.' },
    { key: 'paradigm',   name: 'Paradigm',   short: 'Para',    domain: 'pattern',    object: 'significance',
      blurb: 'Categorical framings — paradigms, worldviews.' }
  ]);

  // Quick lookup tables.
  const BY_KEY = Object.create(null);
  const BY_DOMAIN_OBJECT = Object.create(null);
  for (const t of TERRAINS) {
    BY_KEY[t.key] = t;
    BY_DOMAIN_OBJECT[t.domain + '|' + t.object] = t;
  }

  function byKey(domain, object) {
    return BY_DOMAIN_OBJECT[domain + '|' + object] || null;
  }

  function terrainOfPhasepost(pp) {
    if (!Array.isArray(pp) || pp.length !== 3) return null;
    return byKey(pp[1], pp[2]);
  }

  // Color comes from the row (domain). Subtype distinction (Ground vs
  // Particular vs Pattern) is encoded in shape on the graph; CSS
  // variables read this for the terrain panel and the detail badge.
  function colorOf(terrain) {
    if (!terrain) return '#888';
    return COLOR_BY_ROW[terrain.domain] || '#888';
  }

  // Given a per-anchor cellPopulations map (cellAddrString -> count),
  // return the terrain whose cells dominate the count. If no
  // observation lands in a recognized cell, returns null.
  function dominantTerrain(cellPopulations) {
    if (!cellPopulations || typeof cellPopulations !== 'object') return null;
    const tally = Object.create(null);
    for (const [cell, n] of Object.entries(cellPopulations)) {
      // cell looks like '[mode,domain,object]'.
      const m = /^\[([^,]+),([^,]+),([^\]]+)\]$/.exec(cell);
      if (!m) continue;
      const t = byKey(m[2], m[3]);
      if (!t) continue;
      tally[t.key] = (tally[t.key] || 0) + n;
    }
    let best = null;
    let bestN = -1;
    for (const [k, n] of Object.entries(tally)) {
      if (n > bestN) { best = k; bestN = n; }
    }
    return best ? BY_KEY[best] : null;
  }

  // Aggregate corpus-wide population per terrain, for the left-rail
  // density bars. Returns { terrain_key -> count }.
  function corpusTerrainCounts(projection) {
    const out = Object.create(null);
    for (const t of TERRAINS) out[t.key] = 0;
    if (!projection || !projection.cellPopulations) return out;
    for (const aid of Object.keys(projection.cellPopulations)) {
      const cells = projection.cellPopulations[aid];
      for (const [cell, n] of Object.entries(cells || {})) {
        const m = /^\[([^,]+),([^,]+),([^\]]+)\]$/.exec(cell);
        if (!m) continue;
        const t = byKey(m[2], m[3]);
        if (!t) continue;
        out[t.key] += n;
      }
    }
    return out;
  }

  global.AnchorageTerrains = {
    TERRAINS,
    GRID_ROWS,
    GRID_COLS,
    COLOR_BY_ROW,
    byKey,
    terrainOfPhasepost,
    colorOf,
    dominantTerrain,
    corpusTerrainCounts
  };
})(typeof window !== 'undefined' ? window : globalThis);
