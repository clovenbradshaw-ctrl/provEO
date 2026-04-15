revamp the entire ux and wire up backend changes as needed for this use case

# NL Explorer — UX Specification
## Grounded in the Pipeline Architecture

---

## What the Backend Actually Is

This is the EO fold running on text as its domain.

Nine pipeline stages, each mapping to an operator. The fold walks through each stage in dependency order and accumulates an operator log. Every entry in that log carries a character span, a document anchor, a confidence score, and the stage that produced it. The log is not metadata attached to provenance. The log *is* provenance — because the log is how the system knows anything at all.

**stageINS** — mints content-addressed anchors for the document and for each discovered entity cluster. The identity threshold. Everything below INS is ephemeral signal. From INS forward, entries are permanent.

**stageSIG** — noun phrase recurrences, definition syntax hits (`hereinafter`, `means`, `shall mean`), money/date/org/person detections. Ephemeral. The raw attention layer: what did the text ask the pipeline to notice?

**stageSEG** — sentence and clause boundaries. The structural skeleton everything else hangs from.

**stageCON** — SVO extraction via dependency parse. Subject-verb-object triples become edges in the graph. Two entities in the same clause with a verb connecting them is a logged relationship.

**stageEVA** — cross-document value comparison. The same normalized span appearing with different values across documents is a conflict, logged with both values and a null resolution field. Also runs BFS graph traversal per entity, testing whether accumulated CON-reachable structure satisfies, extends, contracts, or conflicts with the entity's established DEF frame. EVA is the pipeline thinking.

**stageNUL** — absence detection. Expected entities that don't appear. Defined terms that surface once then vanish. Disclosure fields that should be present and aren't. NUL is not nothing. It is the structured detection of structured silence.

**stageDEF** — cross-document conflict registration. Where two documents have incompatible values for the same anchor, DEF logs both values and a null resolution. The null is explicit — the system stops at the boundary of what it can determine mechanically.

**stageREC_from_eva** — fires when EVA finds conflicts or substantial frame extension. Produces an evolved DEF frame absorbing new reachable nodes. Marks the prior frame as superseded. REC is learning.

**stageINFER_site_face** — infers entity type from structural position alone. Verb ratios, hub status in the CON graph, EVA result distribution, surface form count, definition load. No regex. No domain knowledge. Type emerges from position in the operator log the same way it emerges in language — from structural role, not from a label applied.

The **wave fold** governs stage scheduling. Stages without dependencies on each other fan out in parallel. SIG and SEG are independent — they run concurrently. CON depends on both — it serializes after they converge. EO's helix dependency ordering is the scheduling grammar, not a metaphor about it.

---

## The Three Modes

The app has three modes. They share one log, one source library, one instruction set. The modes are entry points to the same underlying system, not separate tools.

---

### Mode 1: Write

Michael is writing the article in the app. The pipeline runs live as he types.

This is the most important mode to get right. If you write the article in the app, every sentence is simultaneously prose and an ingest event. The pipeline doesn't wait for you to finish. It runs continuously against the indexed source library.

**The editor surface is a standard prose editor.** No special syntax. No markup. No metadata fields. You write. The pipeline works behind it.

As each sentence completes, the pipeline processes it:

- Entities in the sentence are matched against anchors in the source library
- Numerical values are cross-referenced against stageEVA in the source logs
- Relationships expressed (subject-verb-object) are compared to CON edges in the source graph
- Absent sources for any claim are flagged as stageNUL events

**Visual feedback is in-line and minimal:**

A solid amber underline appears under any claim that the pipeline has grounded mechanically. It appears silently — no popup, no interruption. You see it and know: that claim has a source.

A dotted amber underline appears under a claim the pipeline partially matched — something is there but it didn't resolve cleanly.

A thin red underline appears when EVA has fired a conflict — you wrote something that contradicts what's in the source log.

No underline means the pipeline either hasn't processed the sentence yet or found no mechanical footing for the claim. That's fine for synthesized language. It's a signal for factual claims.

**The right panel during writing is the claim inspector.** Not always visible. You invoke it by clicking any underlined span. It shows:

- The log path that produced the annotation — which stage, which source document, which span
- For conflicts: both values, both sources, the EVA entry that caught it
- For NUL: what the pipeline expected based on surrounding context and why it expected it
- A "release" button that dismisses the annotation if it's wrong — which feeds the instruction set

The claim inspector closes when you click back into the document. It never takes focus away from writing.

**The bottom status bar** shows live counts as you work: grounded claims, partial matches, active conflicts, absent-source flags. These are small numbers in a row at the bottom of the screen. Not badges. Not alerts. Just a count you can glance at.

**When you're done writing**, you switch to Review. The mode switch triggers a full ingest pass over the complete article — the live pipeline catches most things, but the full pass runs stageREC and stageINFER_site_face across the whole document at once, which can surface things the incremental pass missed.

---

### Mode 2: Review

Whether you wrote in the app or imported an existing article, Review is where you walk through every annotated claim and confirm, correct, or release it.

**The layout is a split:** article on the left, review queue on the right. The article is read-only in this mode. You are not editing. You are auditing.

The queue shows claims in document order. Each card shows:

- The claim text, with two sentences of surrounding context
- Claim type: grounded / partial / conflict / absent / synthesized
- For grounded: the operation chain from source to claim — stage by stage, readable as plain language
- For conflicts: both values side by side with their sources
- For absent: what was expected and why
- Three actions: **Confirm** · **Correct** · **Release**

Confirm is one tap. The claim is approved, the annotation is locked, the provenance is attached. The article now has a cite-through for that claim.

Correct opens a text field and a source picker. You describe what's wrong. You can optionally point to the right source span. The correction becomes a DEF event in the meta-log — the system's own behavior is being corrected, not just the claim. The correction is attributed, timestamped, and feeds the instruction set review queue.

Release removes the annotation. The claim appears without provenance in the published output. A released claim is not the same as an unsupported claim — the system tried and was wrong. That is logged too.

**The queue can be filtered** by claim type. Work through conflicts first — those are the claims most likely to be wrong. Then absent flags — those are the claims most likely to be under-supported. Grounded claims last — those you're mostly just confirming.

**Merge candidates** appear as a special queue section. These are entity clusters the pipeline thinks might be the same thing under different surface forms — `"the Authority"` and `"Authority"` and `"the Metro Authority"`. Confirming a merge collapses them to a single anchor. Rejecting it keeps them separate and logs a disambiguation rule so the pipeline doesn't propose the same merge again.

---

### Mode 3: Chat

The user asks a question. The system routes the question to either the fold or the LLM, depending on whether the answer is mechanically derivable.

**Fold-computable answers** require no LLM at all. "What is NDP's relationship to OHS?" is a graph query. Walk the CON edges from NDP. Find OHS. Return the path — the verb chains, the document anchors, the spans. The answer is a subgraph. Every node in it links to a character span in a primary source. The LLM is not consulted.

**LLM-evaluated answers** are needed when the question asks for synthesis, interpretation, or summary that can't be expressed as graph traversal. The LLM receives the operator log as context, not raw documents. It works from structured operator entries — anchors, frames, CON paths, EVA conflicts — not from full document text. This constrains what it can hallucinate, because the input is already structured.

LLM output is ingested back through the pipeline before rendering. Claims in the LLM's response are processed through stageSIG and stageCON against the existing log. Grounded claims get amber underlines. Conflicts with the log surface as EVA events. The response is never rendered as a flat block of prose.

**Response structure on screen:**

The prose response renders normally. Grounded claims are underlined amber. Conflicting claims are underlined red. Claims the pipeline can't evaluate are undecorated.

Below the prose response, a collapsed evidence panel shows every grounded claim as a card. Each card: the claim text, the log path, the source span, the raw result before formatting, and a re-derive button that replays the fold against the source documents live to confirm the claim still holds.

The re-derive button is the trust anchor of the whole chat interface. It means the reader isn't being asked to trust the system's current output. They can watch the system re-derive the answer from the sources in real time.

**NUL claims in chat** — the pipeline can also report what the LLM's response conspicuously omits. If the question is about NDP's budget and the response doesn't mention the conflict between the public budget figure and the internal document figure, the pipeline flags the omission. NUL fires on the LLM response the same way it fires on any document.

---

## The Instruction Set

The instruction set is a meta-log — a separate append-only log that records what the pipeline has learned about how to process text, not what it found in any specific document.

It lives in its own panel. It is not part of the claim inspector. It is not part of the review queue. It is its own surface because it is a different kind of knowledge.

**Every instruction has:**

- Rule type: COREF, XREF, EXTRACTION, MERGE, CONFLICT_THRESHOLD, ABSENCE_PATTERN
- Plain language description — written by the system, editable by the user
- Trigger: `human_correction` · `llm_reflection` · `recursive` (fired by another rule)
- Scope: which operators and source types this rule applies to
- Firing count since creation
- Conflict list: other rules that partially overlap, with a resolve option

**The recursive trigger is where the system gets smarter.** When a rule fires, the firing is logged. When three or more firings result in downstream corrections — meaning the rule was right but incomplete — the system generates a candidate refinement. The refinement shows in a review queue inside the instruction set panel. You approve, edit, or reject it.

A rule that improves a rule. This is the DEF/EVA/REC cycle applied to the pipeline itself. DEF establishes how the pipeline should behave. EVA tests whether the behavior satisfies the standard. REC restructures the frame when it doesn't.

**Instruction corrections are themselves auditable.** Every time you edit a rule, the prior version is preserved. You can see the full history of how any rule evolved. You can revert. You can compare.

**The instruction set can be exported** as a portable JSON file, independent of any document corpus. When you start a new investigation — a new set of source documents — you can import the instruction set from the previous investigation as a prior. The pipeline starts smarter than it started last time.

This is the generalizable intelligence. The document corpus is the specific knowledge. The instruction set is the method. Keep them separate.

---

## Export Formats

**HTML** — the article with provenance embedded as data attributes on every annotated span. A self-contained provenance drawer script is included. The article can be pasted anywhere and the provenance works without a server. When a reader clicks a claim, they see the log path in a right-side drawer. This is the publication format.

**Markdown** — terse inline citations (`[^m1]`) with a generated footnotes section containing source file, location, and operation. For editors and CMS pipelines that strip HTML attributes.

**JSON (full audit)** — two root keys: `claims` (the full log-path schema for every confirmed claim) and `sources` (the indexed source documents with content hashes). A reader with the JSON and the original source documents can independently reconstruct every derivation. This is the archival format and the format for submitting evidence in formal proceedings.

**Diff** — when source documents are updated, a diff export shows which prior claims now mismatch their sources, which are now unsupported, and which new claims are supportable that weren't before. The update format.

---

## What the Published Article Looks Like to a Reader

The article reads normally. One affordance: a small indicator in the top right — "N claims verified · M sources" — that a reader can click to open a summary of the provenance layer.

Clicking any sentence opens the paragraph drawer, which lists every annotated claim in that paragraph with its type and a one-line provenance summary. Clicking a specific claim expands the full log path.

NUL claims — absent evidence — are visible in the drawer if the author chose to surface them. "The filing does not contain a disclosure of X" is a claim with provenance. It should be citable the same way a positive claim is.

The drawer can be navigated by keyboard. A reader going through a long investigation piece can step through every grounded claim in document order and verify each one without leaving the page.

---

## One Design Constraint That Cannot Be Compromised

The pipeline stages are the provenance. Not a representation of the provenance. The stages.

This means the UI can never show a provenance path it computed separately from the log. Every underline, every drawer entry, every conflict flag traces back to a real log entry with a real stage, span, anchor, and confidence score. If the log doesn't have it, the UI doesn't show it.

This is what makes the whole system different from a citation manager or a fact-checker. Those systems add provenance as a layer on top of a document. This system derives the document as a projection of the provenance. The provenance was always underneath. The article made it visible.
