// Cheap verb detector — no POS tagger in the worker. Picks up
// copulas, modals, common auxiliaries, and inflected forms ending
// in -s / -ed / -ing / -en. False positives are acceptable at this
// gate; false negatives would silently drop real clauses.
const AUX_VERBS = new Set([
  'is','are','was','were','be','been','being','am',
  'has','have','had','do','does','did','done','doing',
  'will','shall','would','should','can','could','may','might','must',
  'makes','made','making','take','takes','took','taken','taking',
  'give','gives','gave','given','giving','get','gets','got','getting',
  'go','goes','went','gone','going','come','comes','came','coming',
  'say','says','said','saying','see','sees','saw','seen','seeing'
]);
const VERB_RE = /[a-z]+(?:s|ed|ing|en)$/i;
function looksLikeVerb(w) {
  if (!w) return false;
  const lw = w.toLowerCase();
  if (AUX_VERBS.has(lw)) return true;
  if (lw.length < 4) return false;
  return VERB_RE.test(lw);
}

function tokenize(s) {
  const m = String(s || '').match(/[A-Za-z0-9][A-Za-z0-9'\-]*/g);
  return m || [];
}

function containsVerb(s) {
  const toks = tokenize(s);
  for (const t of toks) { if (looksLikeVerb(t)) return true; }
  return false;
}

function normaliseClause(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

// Sentence splitter: handles ". ! ?" terminators plus common
// abbreviations that would otherwise fragment sentences. Keeps the
// terminating punctuation with the preceding sentence.
const ABBREV = /(?:\b(?:Mr|Mrs|Ms|Dr|Hon|Rev|Sr|Jr|St|Ave|Blvd|Rd|No|vs|etc|e\.g|i\.e|Sen|Rep|Gov|Lt|Col|Gen|Capt|Inc|Corp|Co|Ltd|Ch|Art|Sec|Fig|p|pp|vol)\.)$/i;
function splitSentences(text) {
  const out = [];
  const src = String(text || '');
  let buf = '';
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    buf += ch;
    if (ch === '.' || ch === '!' || ch === '?') {
      const next = src[i + 1];
      const isEnd = !next || /\s/.test(next);
      if (isEnd && !ABBREV.test(buf)) {
        const trimmed = buf.trim();
        if (trimmed) out.push({ text: trimmed, end: i + 1 });
        buf = '';
      }
    }
    i++;
  }
  const tail = buf.trim();
  if (tail) out.push({ text: tail, end: src.length });
  return out;
}

// Clause splitter: breaks on commas, semicolons, and the
// coordinating conjunctions ", and" / ", but" / ", or". Cleans up
// leading conjunctions on each clause. Filters per app2.py's
// declarative rule set: 8-30 tokens, must contain a verb, dedup.
function splitClauses(sentence) {
  const parts = [];
  // Split on ; first — strong separator.
  const semi = sentence.split(/;\s+/);
  for (const chunk of semi) {
    // Then on ", and" / ", but" / ", or" / ", so" / ", yet".
    const conj = chunk.split(/,\s+(?=(?:and|but|or|so|yet)\b)/i);
    for (const sub of conj) {
      // Then on bare commas if the resulting part is long enough to
      // stand alone (cheap heuristic: token count >= 6).
      const bits = sub.split(/,\s+/);
      if (bits.length > 1) {
        let buf = '';
        for (const b of bits) {
          if (buf && tokenize(buf).length >= 6) {
            parts.push(buf.trim());
            buf = b;
          } else {
            buf = buf ? (buf + ', ' + b) : b;
          }
        }
        if (buf.trim()) parts.push(buf.trim());
      } else {
        parts.push(sub.trim());
      }
    }
  }
  const seen = new Set();
  const out = [];
  for (let p of parts) {
    p = p.replace(/^(and|but|or|so|yet)\s+/i, '').trim();
    if (!p) continue;
    const toks = tokenize(p);
    if (toks.length < 8 || toks.length > 30) continue;
    if (!containsVerb(p)) continue;
    const key = normaliseClause(p);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

// Section splitter. Recognises markdown ATX headings (# / ## / ###),
// all-caps lines followed by a blank line, and numbered headings
// ("1.", "1.1", "ARTICLE I"). Falls back to a single "body" section.
function splitSections(text) {
  const lines = String(text || '').split(/\n/);
  const sections = [];
  let cur = { heading: '', start: 0, end: 0, body: [] };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Page markers aren't headings — they're pagination metadata.
    if (/^\f?\[page \d+\]$/.test(trimmed)) { cur.body.push(line); continue; }
    const isMd = /^#{1,6}\s+\S/.test(trimmed);
    const isNumbered = /^(?:ARTICLE\s+[IVXLC]+|Section\s+\d+|\d+(?:\.\d+)*\.)\s+\S/.test(trimmed);
    const nextBlank = !lines[i + 1] || !lines[i + 1].trim();
    const isAllCaps = trimmed.length >= 4 && trimmed.length <= 80
      && /^[A-Z0-9][A-Z0-9 \-:,'&().]+$/.test(trimmed)
      && /[A-Z]/.test(trimmed) && nextBlank;
    if (isMd || isNumbered || isAllCaps) {
      if (cur.body.length || cur.heading) {
        cur.end = i;
        sections.push(cur);
      }
      cur = { heading: trimmed, start: i, end: i, body: [] };
    } else {
      cur.body.push(line);
    }
  }
  if (cur.body.length || cur.heading) {
    cur.end = lines.length;
    sections.push(cur);
  }
  return sections;
}

// Paragraph splitter: blank-line delimited within a section.
function splitParagraphs(lines) {
  const paras = [];
  let buf = [];
  let startLine = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (ln.trim() === '') {
      if (buf.length) {
        paras.push({ text: buf.join('\n').trim(), lineStart: startLine, lineEnd: i - 1 });
      }
      buf = [];
      startLine = i + 1;
    } else {
      if (!buf.length) startLine = i;
      buf.push(ln);
    }
  }
  if (buf.length) paras.push({ text: buf.join('\n').trim(), lineStart: startLine, lineEnd: lines.length - 1 });
  return paras;
}

// Build a per-line page map from \f[page N] markers for PDFs. Line
// numbers are 0-based over the full extracted text. Returns a sorted
// array of { line, page } cut points; callers look up a line with
// lookupPage(pageMap, line).
function buildPdfPageMap(text) {
  const lines = String(text || '').split('\n');
  const cuts = [];
  let curPage = 1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\f?\[page (\d+)\]$/);
    if (m) {
      curPage = Number(m[1]);
      cuts.push({ line: i, page: curPage });
    } else if (lines[i].startsWith('\f[page ')) {
      const m2 = lines[i].match(/\f\[page (\d+)\]/);
      if (m2) { curPage = Number(m2[1]); cuts.push({ line: i, page: curPage }); }
    }
  }
  if (!cuts.length || cuts[0].line > 0) cuts.unshift({ line: 0, page: 1 });
  return cuts;
}

function lookupPage(pageMap, line) {
  if (!pageMap || !pageMap.length) return 1;
  let lo = 0, hi = pageMap.length - 1, best = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pageMap[mid].line <= line) { best = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return pageMap[best].page;
}

// Segment id allocator — deterministic within a single run so
// re-segmenting the same text yields identical ids. Prefixes are
// chosen to be unambiguous (sec vs sent both start with 's').
// Keys match the short tags used at the call sites below (sec / para
// / sent / cl / row). 'section' is 'sec' not 's' so it can't collide
// with 'sentence'.
const KIND_PREFIX = { sec: 'sec', para: 'p', sent: 'st', cl: 'cl', row: 'r' };
function mkId(sourceId, kind, seq) {
  return sourceId + ':' + (KIND_PREFIX[kind] || kind) + seq;
}

function tokenCount(s) { return tokenize(s).length; }

// PDF page markers — we keep them for page-map construction but
// strip them from segment text so they don't pollute downstream
// embeddings or classification.
const PAGE_MARKER_RE = /^\f?\[page \d+\]$/;

function segmentText(sourceId, text, kind) {
  const out = [];
  const pageMap = kind === 'pdf' ? buildPdfPageMap(text) : null;
  const isTable = kind === 'csv' || kind === 'tsv';
  const sections = splitSections(text);
  let sSeq = 0, pSeq = 0, stSeq = 0, clSeq = 0;

  const sourceNodeId = sourceId + ':root';
  out.push({
    id: sourceNodeId,
    parentId: null,
    kind: 'source',
    text: '',
    loc: kind === 'pdf'
      ? { pageStart: pageMap && pageMap.length ? pageMap[0].page : 1,
          pageEnd: pageMap && pageMap.length ? pageMap[pageMap.length - 1].page : 1 }
      : { lineStart: 0, lineEnd: (text.match(/\n/g) || []).length },
    tokens: tokenCount(text)
  });

  if (isTable) {
    // CSVs get one row-grained segment per non-empty line. No
    // sections/paragraphs/sentences inside — the structured index
    // already addresses cells directly. rowStart/rowEnd are
    // 1-based data rows (header = row 0).
    const lines = String(text || '').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln.trim()) continue;
      const id = mkId(sourceId, 'row', ++pSeq);
      out.push({
        id,
        parentId: sourceNodeId,
        kind: 'row',
        text: ln.trim(),
        loc: { rowStart: i, rowEnd: i, lineStart: i, lineEnd: i },
        tokens: tokenCount(ln)
      });
    }
    return out;
  }

  for (const sec of sections) {
    const secLines = String(text || '').split('\n').slice(sec.start, sec.end);
    const secText = secLines.join('\n').trim();
    if (!secText) continue;
    const secId = mkId(sourceId, 'sec', ++sSeq);
    // Pick a display text: heading first; else first non-blank,
    // non-page-marker line.
    let secDisplay = sec.heading || '';
    if (!secDisplay) {
      for (const ln of secLines) {
        const t = ln.trim();
        if (!t) continue;
        if (kind === 'pdf' && PAGE_MARKER_RE.test(t)) continue;
        secDisplay = t; break;
      }
    }
    out.push({
      id: secId,
      parentId: sourceNodeId,
      kind: 'section',
      text: secDisplay,
      loc: kind === 'pdf'
        ? { pageStart: lookupPage(pageMap, sec.start), pageEnd: lookupPage(pageMap, Math.max(sec.start, sec.end - 1)) }
        : { lineStart: sec.start, lineEnd: Math.max(sec.start, sec.end - 1) },
      tokens: tokenCount(secText)
    });
    // If this section starts with its heading on line 0, drop that
    // line from the paragraph pass — it's already captured as the
    // section's own text node. Prevents the heading from appearing
    // twice in the tree.
    const bodyLinesRaw = (sec.heading && secLines.length && secLines[0].trim() === sec.heading)
      ? secLines.slice(1)
      : secLines;
    const bodyOffset = secLines.length - bodyLinesRaw.length;
    // Strip PDF page markers from the body before paragraph splitting.
    // We replace them with empty lines so line-number math downstream
    // still lines up with the original text coordinates.
    const bodyLines = kind === 'pdf'
      ? bodyLinesRaw.map(l => PAGE_MARKER_RE.test(l.trim()) ? '' : l)
      : bodyLinesRaw;
    const paras = splitParagraphs(bodyLines);
    for (const para of paras) {
      if (!para.text) continue;
      // Skip page-marker-only "paragraphs" in PDFs so they don't
      // pollute the tree with junk nodes.
      if (kind === 'pdf' && /^\f?\[page \d+\]$/.test(para.text.trim())) continue;
      para.lineStart = para.lineStart + bodyOffset;
      para.lineEnd = para.lineEnd + bodyOffset;
      const absLineStart = sec.start + para.lineStart;
      const absLineEnd = sec.start + para.lineEnd;
      const pId = mkId(sourceId, 'para', ++pSeq);
      out.push({
        id: pId,
        parentId: secId,
        kind: 'paragraph',
        text: para.text,
        loc: kind === 'pdf'
          ? { pageStart: lookupPage(pageMap, absLineStart), pageEnd: lookupPage(pageMap, absLineEnd) }
          : { lineStart: absLineStart, lineEnd: absLineEnd },
        tokens: tokenCount(para.text)
      });
      const sentences = splitSentences(para.text);
      for (const s of sentences) {
        if (!s.text) continue;
        const sId = mkId(sourceId, 'sent', ++stSeq);
        out.push({
          id: sId,
          parentId: pId,
          kind: 'sentence',
          text: s.text,
          loc: kind === 'pdf'
            ? { pageStart: lookupPage(pageMap, absLineStart), pageEnd: lookupPage(pageMap, absLineEnd) }
            : { lineStart: absLineStart, lineEnd: absLineEnd },
          tokens: tokenCount(s.text)
        });
        const clauses = splitClauses(s.text);
        for (const cl of clauses) {
          const cId = mkId(sourceId, 'cl', ++clSeq);
          out.push({
            id: cId,
            parentId: sId,
            kind: 'clause',
            text: cl,
            loc: kind === 'pdf'
              ? { pageStart: lookupPage(pageMap, absLineStart), pageEnd: lookupPage(pageMap, absLineEnd) }
              : { lineStart: absLineStart, lineEnd: absLineEnd },
            tokens: tokenCount(cl)
          });
        }
      }
    }
  }
  return out;
}

self.addEventListener('message', (ev) => {
  const msg = ev.data || {};
  if (msg.type !== 'segment') return;
  try {
    const segments = segmentText(msg.sourceId || 'src', String(msg.text || ''), msg.kind || 'txt');
    self.postMessage({ type: 'segments', sourceId: msg.sourceId, segments });
  } catch (err) {
    self.postMessage({ type: 'error', sourceId: msg.sourceId, error: String(err && err.message || err) });
  }
});
