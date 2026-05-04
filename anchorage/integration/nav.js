// Cross-mode navigation header for Anchorage — standalone injector.
//
// Used when a page is loaded directly (not through the anchorage.html shell).
// Injects a fixed-position mode toggle in the top-right corner so the user
// can always reach the other mode. The shell uses its own inline nav.

(function () {
  if (window.top !== window.self) return;  // inside the shell iframe; shell owns the nav

  const path = location.pathname;
  const isReading = /(?:^|\/)read(?:\.html)?$/.test(path);
  const isWriting = !isReading;

  const css = `
    .anchorage-nav {
      position: fixed; top: 8px; right: 8px;
      z-index: 2147483646;
      display: flex; gap: 0;
      font: 12px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      background: rgba(20,20,24,0.92); color: #ddd;
      border-radius: 6px; padding: 0;
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      user-select: none;
    }
    .anchorage-nav a {
      display: block; padding: 7px 11px;
      color: #ddd; text-decoration: none;
      border-radius: 5px;
    }
    .anchorage-nav a.active { background: #2a3a4a; color: #9cf; cursor: default; }
    .anchorage-nav a:hover:not(.active) { background: rgba(255,255,255,0.10); }
    .anchorage-nav .anchorage-brand {
      padding: 7px 11px 7px 13px; color: #9aa3ad;
      border-right: 1px solid rgba(255,255,255,0.1);
      letter-spacing: 0.04em;
    }
  `;

  function inject() {
    if (document.querySelector('.anchorage-nav')) return;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);

    const nav = document.createElement('nav');
    nav.className = 'anchorage-nav';
    nav.setAttribute('aria-label', 'Anchorage mode');
    nav.innerHTML =
      '<a href="anchorage.html" class="anchorage-brand">Anchorage</a>' +
      '<a href="anchorage.html#mode=writing"' + (isWriting ? ' class="active" aria-current="page"' : '') + '>Writing</a>' +
      '<a href="anchorage.html#mode=reading"' + (isReading ? ' class="active" aria-current="page"' : '') + '>Reading</a>';
    document.body.appendChild(nav);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
