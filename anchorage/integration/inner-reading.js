// Inner module for the READING iframe (eoreader content).
//
// Injected by read.html into its child iframe at load time. Wires the
// reading-mode DOM to the shell's citation bridge using opt-in conventions:
//
//   data-anchorage-cite  on a click target sends a 'cite' to writing mode
//   data-anchorage-jump  on a click target sends a 'jump' to writing mode
//   data-anchorage-src, data-anchorage-anchor  carry the cursor coordinates
//
// Also adds a hover "Cite this" affordance on any clause-shaped element
// that carries a recognizable cursor, so reading-app users can cite even
// before the eoreader code adopts the data-attribute conventions.
//
// On a 'cursor' message from the shell, scrolls to the matching element
// and flashes it.

import { Inner } from './citation-bridge.js';

Inner.ready('reading');

// ---- cursor extraction -----------------------------------------------------

function cursorFromElement(el) {
  if (!el) return null;
  const tagged = el.closest(
    '[data-anchorage-cite], [data-anchorage-jump], [data-anchorage-src], [data-anchorage-anchor]'
  );
  if (tagged) {
    const cursor = {};
    if (tagged.dataset.anchorageSrc)    cursor.src    = tagged.dataset.anchorageSrc;
    if (tagged.dataset.anchorageAnchor) cursor.anchor = tagged.dataset.anchorageAnchor;
    if (Object.keys(cursor).length) return cursor;
  }
  const generic = el.closest('[data-src], [data-anchor], [data-clause-id], [data-cell-key]');
  if (generic) {
    const cursor = {};
    if (generic.dataset.src)       cursor.src    = generic.dataset.src;
    if (generic.dataset.anchor)    cursor.anchor = generic.dataset.anchor;
    if (generic.dataset.clauseId)  cursor.src    = cursor.src || ('doc:?:cl:' + generic.dataset.clauseId);
    if (generic.dataset.cellKey)   cursor.cell   = generic.dataset.cellKey;
    if (Object.keys(cursor).length) return cursor;
  }
  return null;
}

// ---- click delegation ------------------------------------------------------

document.addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;

  const cite = e.target.closest('[data-anchorage-cite]');
  if (cite) {
    const cursor = cursorFromElement(cite);
    if (cursor) {
      e.preventDefault();
      Inner.cite(cursor);
      return;
    }
  }

  const jump = e.target.closest('[data-anchorage-jump]');
  if (jump) {
    const cursor = cursorFromElement(jump);
    if (cursor) {
      e.preventDefault();
      Inner.jump('writing', cursor);
      return;
    }
  }
}, true);

// ---- hover affordance: floating "Cite" button on cursor-bearing elements --
//
// Disabled when the page already provides explicit data-anchorage-cite
// targets (so we don't shadow the app's own UI).

let btn = null;
let hoverTarget = null;

function ensureBtn() {
  if (btn) return btn;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Cite →';
  btn.setAttribute('aria-label', 'Cite this in writing mode');
  btn.style.cssText = `
    position: fixed; z-index: 2147483645;
    appearance: none; border: 0;
    background: #14181f; color: #9cf;
    font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
    padding: 5px 8px; border-radius: 5px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.25);
    cursor: pointer; opacity: 0; pointer-events: none;
    transition: opacity 80ms ease;
  `;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!hoverTarget) return;
    const cursor = cursorFromElement(hoverTarget);
    if (cursor) Inner.cite(cursor);
  });
  document.body.appendChild(btn);
  return btn;
}

function showBtnFor(el) {
  const b = ensureBtn();
  hoverTarget = el;
  const r = el.getBoundingClientRect();
  b.style.top  = Math.max(4, r.top - 26) + 'px';
  b.style.left = Math.min(window.innerWidth - 60, r.right - 50) + 'px';
  b.style.opacity = '1';
  b.style.pointerEvents = 'auto';
}

function hideBtn() {
  if (!btn) return;
  btn.style.opacity = '0';
  btn.style.pointerEvents = 'none';
  hoverTarget = null;
}

document.addEventListener('mouseover', (e) => {
  if (document.querySelector('[data-anchorage-cite]')) return;  // app handles it
  const candidate = e.target.closest('[data-src], [data-anchor], [data-clause-id], [data-cell-key]');
  if (!candidate || !cursorFromElement(candidate)) { hideBtn(); return; }
  showBtnFor(candidate);
});
document.addEventListener('mouseleave', hideBtn);

// ---- 'cursor' from shell: scroll + flash ----------------------------------

const flashCss = document.createElement('style');
flashCss.textContent = `
  .anchorage-flash {
    outline: 2px solid #f80;
    outline-offset: 2px;
    transition: outline-color 1.5s ease-out;
  }
`;
document.head.appendChild(flashCss);

function findCursorTarget(cursor) {
  if (!cursor) return null;
  if (cursor.src) {
    const t = document.querySelector(`[data-src="${cssEscape(cursor.src)}"]`);
    if (t) return t;
    const m = /^doc:[^:]+:cl:(.+)$/.exec(cursor.src);
    if (m) {
      const t2 = document.querySelector(`[data-clause-id="${cssEscape(m[1])}"]`);
      if (t2) return t2;
    }
  }
  if (cursor.anchor) {
    const t = document.querySelector(`[data-anchor="${cssEscape(cursor.anchor)}"]`);
    if (t) return t;
    const t2 = document.getElementById(cursor.anchor);
    if (t2) return t2;
  }
  if (cursor.cell) {
    const t = document.querySelector(`[data-cell-key="${cssEscape(cursor.cell)}"]`);
    if (t) return t;
  }
  return null;
}

Inner.onCursor((cursor) => {
  const target = findCursorTarget(cursor);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  target.classList.add('anchorage-flash');
  setTimeout(() => target.classList.remove('anchorage-flash'), 1800);
});

function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }
