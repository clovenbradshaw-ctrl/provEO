// Citation bridge between Anchorage modes.
//
// The shell (anchorage.html) hosts one mode at a time in an iframe. This
// module owns the wire protocol both sides of that boundary speak.
//
// Direction         Kind       Payload                              Sender
// ------------------------------------------------------------------------
// inner -> parent   ready      { mode }                             inner-{writing,reading}.js
// inner -> parent   jump       { mode, cursor }                     inner click on jump-tagged element
// inner -> parent   cite       { cursor }                           inner click on cite-tagged element
// shell -> iframe   cursor     { cursor }                           after mode switch with cursor
// shell -> iframe   cite       { cursor }                           after a cross-mode cite arrives
//
// Read.html is a passthrough: it forwards every anchorage message in both
// directions between its parent (shell) and its child (eoreader iframe).
//
// URL fragment encoding (deep links, refresh, share):
//   #mode=reading&src=doc:1:cl:42&anchor=ent:river-truckee
//
// All frames are assumed same-origin (true on github.io for this repo set).

export function parseAnchorageHash(hash) {
  const out = { mode: null, cursor: null };
  if (!hash || hash.length < 2) return out;
  const params = new URLSearchParams(hash.slice(1));
  if (params.has('mode')) out.mode = params.get('mode');
  const cursor = {};
  for (const [k, v] of params) {
    if (k === 'mode') continue;
    cursor[k] = v;
  }
  if (Object.keys(cursor).length) out.cursor = cursor;
  return out;
}

export function formatAnchorageHash({ mode, cursor }) {
  const params = new URLSearchParams();
  if (mode) params.set('mode', mode);
  if (cursor) for (const [k, v] of Object.entries(cursor)) params.set(k, v);
  const s = params.toString();
  return s ? '#' + s : '';
}

// Shell-side bridge: collects messages from the iframe (and any iframe-of-
// iframe forwarded through it). Subscribers receive typed events.
export class CitationBridge {
  constructor({ frame }) {
    this.frame = frame;
    this.handlers = new Map();
    this._readyMode = null;
    this._pendingCursor = null;
    this._pendingCite = [];

    addEventListener('message', (e) => this._handle(e));
  }

  on(kind, fn) {
    if (!this.handlers.has(kind)) this.handlers.set(kind, new Set());
    this.handlers.get(kind).add(fn);
    return () => this.handlers.get(kind).delete(fn);
  }

  _emit(kind, payload) {
    const set = this.handlers.get(kind);
    if (!set) return;
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error('[anchorage bridge]', kind, e); }
    }
  }

  _handle(e) {
    const m = e.data;
    if (!m || m.source !== 'anchorage') return;
    if (m.kind === 'ready') {
      this._readyMode = m.mode;
      this._emit('ready', { mode: m.mode });
      if (this._pendingCursor && this._pendingCursor.mode === m.mode) {
        this.sendCursor(this._pendingCursor.cursor);
        this._pendingCursor = null;
      }
      while (this._pendingCite.length) this._postToFrame(this._pendingCite.shift());
    } else if (m.kind === 'jump') {
      this._emit('jump', { mode: m.mode, cursor: m.cursor });
    } else if (m.kind === 'cite') {
      this._emit('cite', { cursor: m.cursor });
      const msg = { source: 'anchorage', kind: 'cite', cursor: m.cursor };
      this._pendingCite.push(msg);
      this._postToFrame(msg);
    }
  }

  // Send a cursor to the active iframe. If the iframe isn't ready yet,
  // queue it for the next 'ready' message in the matching mode.
  sendCursor(cursor, expectedMode) {
    if (expectedMode && this._readyMode !== expectedMode) {
      this._pendingCursor = { mode: expectedMode, cursor };
      return;
    }
    this._postToFrame({ source: 'anchorage', kind: 'cursor', cursor });
  }

  // Reset bookkeeping when the shell swaps the iframe to a new mode.
  modeWillChange(newMode) {
    this._readyMode = null;
  }

  _postToFrame(msg) {
    try { this.frame.contentWindow && this.frame.contentWindow.postMessage(msg, '*'); }
    catch { /* iframe not ready */ }
  }
}

// Inner-app helpers — thin convenience wrappers the writing and reading
// apps can call without depending on this module's class.
export const Inner = {
  ready(mode) {
    if (!parent || parent === window) return;
    parent.postMessage({ source: 'anchorage', kind: 'ready', mode }, '*');
  },
  jump(mode, cursor) {
    if (!parent || parent === window) return;
    parent.postMessage({ source: 'anchorage', kind: 'jump', mode, cursor }, '*');
  },
  cite(cursor) {
    if (!parent || parent === window) return;
    parent.postMessage({ source: 'anchorage', kind: 'cite', cursor }, '*');
  },
  onCite(fn) {
    addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.source !== 'anchorage' || m.kind !== 'cite') return;
      fn(m.cursor);
    });
  },
  onCursor(fn) {
    addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.source !== 'anchorage' || m.kind !== 'cursor') return;
      fn(m.cursor);
    });
  }
};
