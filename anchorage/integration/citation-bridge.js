// Citation bridge between Anchorage modes.
//
// The shell (anchorage.html) hosts one mode at a time in an iframe. This
// module owns the wire protocol both sides of that boundary speak.
//
// Protocol (postMessage, source: 'anchorage'):
//
//   { source:'anchorage', kind:'jump', mode:'reading'|'writing', cursor:{src,anchor,...} }
//     — sent by the inner app when the user clicks a citation; the shell
//       switches modes and forwards the cursor as a URL fragment so the
//       receiving inner page can scroll/highlight.
//
//   { source:'anchorage', kind:'cite', cursor:{src,anchor,...} }
//     — sent by the reading inner app when the user clicks "Cite this";
//       the shell forwards to the writing inner app so a citation can be
//       inserted at the editor caret.
//
//   { source:'anchorage', kind:'ready', mode:'reading'|'writing' }
//     — sent by the inner app once it has booted and is ready to receive
//       cursor messages.
//
// URL fragment encoding (deep links, refresh, share):
//   #mode=reading&src=doc:1:cl:42&anchor=ent:river-truckee

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

// Shell-side bridge: listens for postMessage events from the iframe and
// dispatches typed events to subscribers. Forwards 'cite' messages back
// into the iframe so the writing app can insert a citation at the caret.
export class CitationBridge {
  constructor({ frame }) {
    this.frame = frame;
    this.handlers = new Map();
    this._lastReadyMode = null;
    this._pendingForward = [];

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
      this._lastReadyMode = m.mode;
      while (this._pendingForward.length) {
        const msg = this._pendingForward.shift();
        this._postToFrame(msg);
      }
    } else if (m.kind === 'jump') {
      this._emit('jump', { mode: m.mode, cursor: m.cursor });
    } else if (m.kind === 'cite') {
      // forward to the iframe (which will be the writing app once mode is switched)
      this._emit('cite', { cursor: m.cursor });
      this._pendingForward.push({ source: 'anchorage', kind: 'cite', cursor: m.cursor });
      // attempt immediate forward in case writing is already loaded
      this._postToFrame({ source: 'anchorage', kind: 'cite', cursor: m.cursor });
    }
  }

  _postToFrame(msg) {
    try { this.frame.contentWindow && this.frame.contentWindow.postMessage(msg, '*'); }
    catch (e) { /* iframe not ready or cross-origin block */ }
  }
}

// Inner-app helpers — thin convenience wrappers the writing and reading
// apps can call without depending on this module's class.
export const Inner = {
  ready(mode) {
    parent.postMessage({ source: 'anchorage', kind: 'ready', mode }, '*');
  },
  jump(mode, cursor) {
    parent.postMessage({ source: 'anchorage', kind: 'jump', mode, cursor }, '*');
  },
  cite(cursor) {
    parent.postMessage({ source: 'anchorage', kind: 'cite', cursor }, '*');
  },
  onCite(fn) {
    addEventListener('message', (e) => {
      const m = e.data;
      if (!m || m.source !== 'anchorage' || m.kind !== 'cite') return;
      fn(m.cursor);
    });
  }
};
