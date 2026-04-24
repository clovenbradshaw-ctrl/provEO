/* ---------- ULID-ish ids (sortable-by-time, no deps) ---------- */
function ulid() {
  // simplified — not spec-strict ULID but lexicographically time-sortable
  const t = Date.now().toString(36).padStart(10, '0');
  const r = [...crypto.getRandomValues(new Uint8Array(10))]
    .map(b => b.toString(36).padStart(2, '0')).join('').slice(0, 16);
  return `${t}${r}`;
}
