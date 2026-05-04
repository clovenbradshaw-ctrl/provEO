// Inner module for the WRITING iframe (proveo's index.html).
//
// Injected by anchorage.html into the writing-mode iframe at load time.
// Reads the existing proveo citation DOM (.cite-badge, .fn-source, etc.)
// and wires it to the shell's citation bridge. Adds opt-in conventions for
// future cleanly-tagged citation elements:
//
//   data-anchorage-jump  on a click target opens the cursor in reading mode
//   data-anchorage-src, data-anchorage-anchor  carry the cursor coordinates
//
// On a 'cite' message from the shell, dispatches a CustomEvent('anchorage:cite')
// the proveo writing app can listen for to insert a citation at the caret.
// If proveo hasn't subscribed yet, the event is harmless.

import { Inner } from './citation-bridge.js';

Inner.ready('writing');

// ---- citation cursor extraction --------------------------------------------
//
// Walks up from a clicked element to find the nearest cursor-bearing
// ancestor. Cursor sources, in priority order:
//
//   1. data-anchorage-* attributes (explicit opt-in convention)
//   2. nearest .footnotes-list <li> with .fn-source href + .fn-loc text
//   3. nearest [data-src] or [data-anchor] (matches existing proveo conventions)
//   4. anchor href that looks like #fn-N -> resolve to footnote and re-extract

function cursorFromElement(el) {
  if (!el) return null;

  // 1. explicit
  const tagged = el.closest('[data-anchorage-jump], [data-anchorage-src], [data-anchorage-anchor]');
  if (tagged) {
    const cursor = {};
    if (tagged.dataset.anchorageSrc)    cursor.src    = tagged.dataset.anchorageSrc;
    if (tagged.dataset.anchorageAnchor) cursor.anchor = tagged.dataset.anchorageAnchor;
    if (Object.keys(cursor).length) return cursor;
  }

  // 4. badge -> footnote resolution
  const badge = el.closest('.cite-badge a');
  if (badge) {
    const href = badge.getAttribute('href') || '';
    if (href.startsWith('#')) {
      const fn = document.getElementById(href.slice(1));
      if (fn) return cursorFromElement(fn);
    }
  }

  // 2. footnote item
  const li = el.closest('.footnotes-list li');
  if (li) {
    const cursor = {};
    const sourceA = li.querySelector('.fn-source a');
    if (sourceA) {
      const href = sourceA.getAttribute('href') || '';
      const txt  = sourceA.textContent.trim();
      if (/^doc:/.test(txt))  cursor.src = txt;
      else if (/^doc:/.test(href)) cursor.src = href;
      else if (href) cursor.src = href;
    }
    const loc = li.querySelector('.fn-loc');
    if (loc) {
      const m = loc.textContent.match(/(?:doc:[A-Za-z0-9_-]+:cl:[A-Za-z0-9_-]+|ent:[A-Za-z0-9_-]+)/g);
      if (m) for (const tok of m) {
        if (tok.startsWith('doc:'))  cursor.src    = tok;
        if (tok.startsWith('ent:'))  cursor.anchor = tok;
      }
    }
    if (Object.keys(cursor).length) return cursor;
  }

  // 3. generic data attributes
  const generic = el.closest('[data-src], [data-anchor]');
  if (generic) {
    const cursor = {};
    if (generic.dataset.src)    cursor.src    = generic.dataset.src;
    if (generic.dataset.anchor) cursor.anchor = generic.dataset.anchor;
    if (Object.keys(cursor).length) return cursor;
  }

  return null;
}

// ---- click delegation ------------------------------------------------------

document.addEventListener('click', (e) => {
  // hold modifier or middle-click — let the browser handle it normally
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

  const cursor = cursorFromElement(e.target);
  if (!cursor) return;

  // only intercept if the click was on a citation-shaped element — avoid
  // hijacking unrelated clicks that happen to be inside a footnote item
  const onCitationSurface = !!(
    e.target.closest('.cite-badge a') ||
    e.target.closest('.fn-source a') ||
    e.target.closest('.fn-claim') ||
    e.target.closest('[data-anchorage-jump]')
  );
  if (!onCitationSurface) return;

  e.preventDefault();
  Inner.jump('reading', cursor);
}, true);  // capture phase — beat any inline handlers

// ---- incoming 'cite' from reading mode -------------------------------------
//
// The proveo writing app subscribes by listening for the custom event:
//
//   document.addEventListener('anchorage:cite', e => {
//     editor.insertCitationAtCaret(e.detail);
//   });
//
// Until the writing app subscribes, the event fires harmlessly.

Inner.onCite((cursor) => {
  const ev = new CustomEvent('anchorage:cite', { detail: cursor, bubbles: true });
  document.dispatchEvent(ev);
});

// ---- incoming 'cursor' (deep link / back-forward) --------------------------
//
// In writing mode, a cursor typically points at a citation that ALREADY
// exists in the draft. Find the matching .cite-badge (by source) and scroll
// to it; flash it briefly to draw the eye.

Inner.onCursor((cursor) => {
  if (!cursor) return;
  const sel = cursor.src ? `[data-src="${cssEscape(cursor.src)}"]` : null;
  let target = sel ? document.querySelector(sel) : null;
  if (!target && cursor.anchor) {
    target = document.querySelector(`[data-anchor="${cssEscape(cursor.anchor)}"]`);
  }
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('cite-flash');
  setTimeout(() => target.classList.remove('cite-flash'), 1200);
});

function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }
