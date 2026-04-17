# Local LLM spec: EO-native entity recognition with DEF→EVA→REC learning

## Core principle

The local model never generates article text. It emits typed classification events, each tagged with the EO operator that produced it. Human reactions are evaluation events. Accumulated evaluation pressure triggers rewrite events that restructure the encoding layer around the model — resolution rules, prototypes, thresholds, prompts. Model weights stay frozen. What learns is the layer on top.

This makes the system structurally alive in the Tabbaa sense: encoding separated from execution, persistent across time, rewritable by accumulated evaluation. The reporter runs the ⊨EVA half of a loop whose ⊛REC half closes automatically.

---

## Stage 1 — ⊢DEF: model proposals

### Stage 1a — DEF-boundary (span detection)

**Input:** raw text window from a source (sentence, paragraph, or cell).
**Model task:** return character spans likely to be entities.
**Output:** array of `{start, end, surface, type_candidate, confidence}`.
**Latency:** ~3-5s for a 30-page PDF; ~0.5s for a CSV row batch.

```js
{
  op: 'DEF',
  site: 'observation:obs_k7n3p4',
  payload: {
    subtype: 'boundary',
    source_id: 'src_council_minutes',
    location: { start: 2847, end: 2868 },
    surface: 'Solaren International',
    type_candidate: 'ORG',
    confidence: 0.97,
    rule_set_version: 'rs_v47',
    agent: 'model:qwen-2.5-3b@v1.2',
    rationale: 'Capitalized noun phrase; corporate suffix-like context'
  }
}
```

**Validation gate:** the span's text must match the source content at that offset exactly. The fold rejects malformed boundary DEFs at parse time. No silent acceptance of phantom spans.

### Stage 1b — DEF-type (disambiguation)

**Trigger:** runs only on boundary DEFs with `confidence < 0.9` or `len(type_candidates) > 1`.
**Input:** the surface plus ~50 chars of surrounding context.
**Model task:** classify the entity type with rationale.
**Output:** `{type, confidence, alternatives: [{type, confidence}]}`.
**Latency:** ~0.3s per ambiguous span; typically 10-20% of all spans.

```js
{
  op: 'DEF',
  site: 'observation:obs_k7n3p4',
  payload: {
    subtype: 'type',
    pi: ['obs_k7n3p4'],          // refines the boundary DEF
    type: 'ORG',
    confidence: 0.91,
    alternatives: [{ type: 'PERSON', confidence: 0.06 }],
    rule_set_version: 'rs_v47',
    agent: 'model:qwen-2.5-3b@v1.2',
    rationale: 'Preceded by "vendor"; succeeded by contract terms'
  }
}
```

### Stage 1c — DEF-link (canonical resolution)

**Trigger:** every typed mention.
**Input:** mention surface + context + pre-filtered candidate list (top 5-10 canonical entities by string similarity from the workspace entity table).
**Model task:** score candidates; return best match or `null`.
**Output:** `{entity_id | null, confidence, rationale, alternatives}`.
**Latency:** ~0.2s per mention with batching; ~2-4s total per document.

```js
{
  op: 'DEF',
  site: 'claim:em_q8r4m2',
  payload: {
    subtype: 'link',
    type: 'entity_mention',
    pi: ['obs_k7n3p4'],
    entity_id: 'org:solaren_intl',
    confidence: 0.94,
    alternatives: [
      { entity_id: 'org:solaren_risk_mgmt', confidence: 0.31 }
    ],
    rule_set_version: 'rs_v47',
    agent: 'model:qwen-2.5-3b@v1.2',
    rationale: 'Surface matches canonical; "private security services" matches category tag'
  }
}
```

**Routing by confidence band:**
- ≥0.95 → indexed and visible in main surfaces
- 0.85–0.95 → indexed with amber tilde marker
- <0.85 → pending review queue, not surfaced in search until confirmed

### Stage 1d — DEF-coref (within-document)

**Trigger:** after all mentions in a document are linked.
**Input:** ordered list of mentions in the document.
**Model task:** group mentions referring to the same entity.
**Output:** array of chains `[{members: [obsIds], canonical_mention, confidence}]`.
**Latency:** ~2-3s per document.

```js
{
  op: 'DEF',
  site: 'link:coref_p2h9x1',
  payload: {
    subtype: 'coref',
    kind: 'coreference',
    members: ['obs_k7n3p4', 'obs_m8l2q7', 'obs_n4r8w3'],
    canonical_mention: 'obs_k7n3p4',
    scope: { source_id: 'src_council_minutes', document_only: true },
    confidence: 0.88,
    rule_set_version: 'rs_v47',
    agent: 'model:qwen-2.5-3b@v1.2'
  }
}
```

**Within-document only.** Cross-document coreference is out of scope; cross-document linkage happens through DEF-link's canonical entity table.

### Stage 1e — DEF-alias (candidate proposal)

**Trigger:** runs on unresolved mentions (DEF-link returned `null`) periodically as a background task.
**Input:** unresolved mention + workspace entity table.
**Model task:** propose that this surface should become an alias of an existing entity.
**Output:** `{surface, candidate_canonical_id, confidence, rationale}`.
**Latency:** ~1-2s per unresolved mention; runs out-of-band, not blocking ingest.

```js
{
  op: 'DEF',
  site: 'proposal:alias_w3k8s2',
  payload: {
    subtype: 'alias',
    surface: 'Solaren Risk Management',
    pi: ['obs_n4r8w3', 'obs_m2q5p9'],   // multiple unresolved obs supporting this
    candidate_canonical_id: 'org:solaren_intl',
    confidence: 0.82,
    rule_set_version: 'rs_v47',
    agent: 'model:qwen-2.5-3b@v1.2',
    rationale: 'String similarity 0.74; co-occurs with NDP and security context across 3 sources'
  }
}
```

---

## Stage 2 — ⊨EVA: evaluation events

Every reaction to a DEF is an EVA event. EVAs evaluate; they never overwrite.

### Stage 2a — Direct human EVA (weight 1.0)

**Trigger:** explicit user action — Accept/Reject button, manual entity edit, alias confirm/deny.
**Input:** target DEF event + verdict + optional reframe target.

```js
{
  op: 'EVA',
  site: 'claim:em_q8r4m2',
  payload: {
    target_event: 'em_q8r4m2',
    verdict: 'confirm' | 'reject' | 'reframe' | 'defer',
    weight: 1.0,
    agent: 'human:user_k2m4',
    reframe_to: null | { entity_id: 'org:solaren_risk_mgmt' },
    note: 'optional reporter note'
  }
}
```

### Stage 2b — Inferred human EVA (weight 0.5)

**Trigger:** reporter performs an action that implies agreement or disagreement with a DEF without explicitly evaluating it.

Cases:
- Reporter anchors a claim whose source span overlaps a DEF-link → silent confirm
- Reporter manually links a span the model already linked to a different entity → silent reframe
- Reporter retracts a claim whose span contains a DEF-link → silent reject

**Conservative rule:** inferred EVAs only fire when the user's action is unambiguous. If the action is consistent with multiple interpretations, no EVA is emitted.

```js
{
  op: 'EVA',
  site: 'claim:em_q8r4m2',
  payload: {
    target_event: 'em_q8r4m2',
    verdict: 'confirm',
    weight: 0.5,
    agent: 'human:user_k2m4',
    inferred_from: { action: 'anchor_claim', claim_id: 'cl_b3p7n5' }
  }
}
```

### Stage 2c — System consistency EVA (weight 0.2)

**Trigger:** the fold detects internal inconsistencies between DEF events. Runs as part of every fold pass.

Cases:
- Coref chain members linked to different canonical IDs (one or both are wrong)
- Two DEFs assert different types for the same surface in the same source
- Confirmed entity X appears in a DEF-link as alternative to the model's primary choice; primary was rejected

**Lowest weight** because it's structural inference, not human judgment. Used as tie-breaker, not primary signal.

```js
{
  op: 'EVA',
  site: 'claim:em_q8r4m2',
  payload: {
    target_event: 'em_q8r4m2',
    verdict: 'reject',
    weight: 0.2,
    agent: 'system:consistency_check',
    detected: 'coref_chain_disagrees',
    related_events: ['em_x4j2k7', 'em_m9p3l1']
  }
}
```

---

## Stage 3 — ⊛REC: ruleset rewrites

⊛REC fires when accumulated EVA pressure on a specific rule or threshold crosses a trigger. Five things REC can rewrite. Each has its own trigger logic, its own evidence requirement, and produces a new `rule_set_version`.

### Stage 3a — REC-alias-add

**Trigger:** ≥3 confirms on reframes pointing the same unresolved surface at the same canonical ID, with total weight ≥2.0.
**Effect:** adds the surface as an alias of the canonical entity in the resolution table.
**Visible:** "Alias added: 'Solaren Risk Management' → Solaren International, based on 3 confirmations."

```js
{
  op: 'REC',
  site: 'ruleset:rs_v48',
  payload: {
    rewrite_type: 'alias_add',
    previous_version: 'rs_v47',
    target: { entity_id: 'org:solaren_intl' },
    change: { add_alias: 'Solaren Risk Management' },
    triggered_by: ['eva_3k4m', 'eva_8p2n', 'eva_q7w5'],
    evidence_weight: 2.4,
    agent: 'system:rewrite_engine'
  }
}
```

### Stage 3b — REC-alias-remove

**Trigger:** ≥5 rejects of model DEFs that used a particular alias for resolution, with total weight ≥3.0.
**Effect:** removes the alias from the canonical entity; future DEF-link calls won't propose this match.
**Visible:** "Alias removed: 'Solaren Energy' was incorrectly mapped to Solaren International (5 rejections)."

### Stage 3c — REC-entity-split

**Trigger:** ≥3 reframes partitioning a canonical entity's mentions across two distinct targets.
**Effect:** splits the canonical entity into two; existing DEF-links are *not* automatically reassigned but flagged for review.
**Visible:** "Entity split: Solaren International → [Solaren International, Solaren Risk Management] based on reporter reframes. 14 prior mentions need review."

```js
{
  op: 'REC',
  site: 'ruleset:rs_v52',
  payload: {
    rewrite_type: 'entity_split',
    previous_version: 'rs_v51',
    target: { entity_id: 'org:solaren_intl' },
    change: {
      split_into: ['org:solaren_intl', 'org:solaren_risk_mgmt'],
      pending_review_count: 14
    },
    triggered_by: ['eva_…', 'eva_…', 'eva_…'],
    evidence_weight: 3.1,
    agent: 'system:rewrite_engine'
  }
}
```

### Stage 3d — REC-entity-merge

**Trigger:** explicit reporter action — "merge these two entities" — plus ≥1 confirming reframe in either direction.
**Effect:** unifies two canonical entities into one; aliases combine; mentions reassign.
**Visible:** "Entities merged: 'Solaren Intl. LLC' → Solaren International by reporter."

### Stage 3e — REC-threshold-lower

**Trigger:** last 20 confirms for a specific entity averaged ≥0.85 confidence with no rejects in that window.
**Effect:** lowers the display threshold for that entity from default to 0.80; previously hidden DEFs surface.
**Visible:** "Threshold lowered for Nashville Downtown Partnership (97% accuracy at confidence 0.85+)."

### Stage 3f — REC-threshold-raise

**Trigger:** last 20 rejects for an entity averaged ≥0.90 confidence.
**Effect:** raises the display threshold; entity gets flagged for ambiguity review.
**Visible:** "Threshold raised for 'Torres' (multiple matching entities; needs disambiguation)."

### Stage 3g — REC-prototype-update

**Trigger:** continuous; runs after every confirmed DEF-link. Updates the few-shot prototype set for the entity.
**Effect:** adds the confirmed mention's context as a positive exemplar in the entity's prototype set; evicts oldest exemplar if set size exceeds limit (default 10).
**Visible:** silent — runs as background maintenance. Reporter can view current prototypes in the entity profile.

```js
{
  op: 'REC',
  site: 'ruleset:rs_v49',
  payload: {
    rewrite_type: 'prototype_update',
    previous_version: 'rs_v48',
    target: { entity_id: 'org:solaren_intl' },
    change: {
      add_prototype: {
        context: '...the contract with Solaren International for security services...',
        source_id: 'src_council_minutes',
        confirmed_via: 'eva_q3p7'
      },
      evict_prototype: 'proto_2x9k'    // oldest in set
    },
    triggered_by: ['eva_q3p7'],
    evidence_weight: 1.0,
    agent: 'system:rewrite_engine'
  }
}
```

### Stage 3h — REC-type-rule

**Trigger:** ≥4 EVAs reframing a specific surface→type mapping in a specific context, with total weight ≥3.0.
**Effect:** adds a context-specific type rule. "Torres within 50 chars of Councilmember → PERSON, p:torres_v" overrides general disambiguation.
**Visible:** "Rule added: 'Torres' near 'Councilmember' → Councilmember Torres."

### Stage 3i — REC-prompt-addition

**Trigger:** ≥5 rejects of the same error pattern. Detected by clustering rejected DEFs on (surface_pattern, context_pattern, wrong_target).
**Human review required.** REC-prompt-addition does not fire automatically — it queues a proposed prompt change for the reporter to approve.
**Effect:** appends an instruction to the model's system prompt for this workspace. Prompt is versioned; each addition links back to triggering EVAs.
**Visible:** "Prompt addition proposed: 'Treat "the Partnership" as coreferent to NDP by default.' Based on 6 corrections. Approve?"

```js
{
  op: 'REC',
  site: 'ruleset:rs_v55',
  payload: {
    rewrite_type: 'prompt_addition',
    previous_version: 'rs_v54',
    change: {
      append_to_prompt: 'When evaluating entities in Nashville municipal documents, treat "the Partnership" and "NDP" as coreferent to org:ndp by default unless context indicates otherwise.'
    },
    triggered_by: ['eva_…', 'eva_…', 'eva_…', 'eva_…', 'eva_…', 'eva_…'],
    evidence_weight: 5.4,
    agent: 'human:user_k2m4',           // human-approved, not auto
    approval: { approved_by: 'user_k2m4', at: '2026-04-17T15:23:00Z' }
  }
}
```

---

## Stage 4 — Counter-rewrites

Rule 9: no rewrite is immune to supersession. The system tracks downstream EVA pressure on each REC event itself.

**Trigger for counter-REC:** if a REC event is followed by ≥3 rejects on DEFs that used the new rule, with total weight ≥2.0, the system queues a counter-REC for review.
**Effect:** reverts the previous REC. Resolution table, threshold, prototype, or prompt returns to prior state. Both the original REC and the counter-REC stay in the log.
**Visible:** "Recent rule reverted: alias 'Solaren Risk Management' caused 4 misclassifications. Reverted to previous state."

```js
{
  op: 'REC',
  site: 'ruleset:rs_v50',
  payload: {
    rewrite_type: 'revert',
    previous_version: 'rs_v49',
    target: { reverts: 'rec_v48' },     // the REC being undone
    change: { revert_to: 'rs_v47' },
    triggered_by: ['eva_3w7m', 'eva_p4k8', 'eva_n2j5'],
    evidence_weight: 2.3,
    agent: 'system:rewrite_engine'
  }
}
```

---

## Stage 5 — Validation gates

Each stage has a validation gate that prevents malformed or pathological events from entering the log.

**DEF gate:** validates that source spans match actual source content; rejects DEFs that reference offsets outside the source or text that doesn't match. Validates that referenced canonical entity IDs exist in the current ruleset.

**EVA gate:** validates that target_event exists. Validates that reframe_to is a valid canonical ID. Rejects EVAs from agents that aren't authenticated to this workspace.

**REC gate:** validates that triggered_by EVAs exist and have sufficient combined weight to meet the trigger. Rejects REC events that lack EVA evidence (Rule 4 enforcement: no skipped ⊨EVA).

---

## Stage 6 — Revalidation

When a REC fires, prior DEFs produced under the old ruleset are *potentially stale*. Revalidation strategy is lazy, not eager.

**Mark stale.** All DEFs with `rule_set_version` older than the current version are tagged stale in the index. Stale ≠ wrong; they remain in the log and remain resolvable.

**Lazy revalidation.** When a stale DEF is viewed in the entity profile or in search results, the model runs once on the current ruleset for that span. If the new DEF agrees with the old, both stay (the old is no longer stale). If they disagree, both stay and the conflict surfaces in the review queue.

**Manual batch revalidation.** A workspace settings action — "Revalidate workspace under current ruleset" — runs in the background, processing all stale DEFs. Progress visible; pausable; resumable.

**Frozen audit trail.** Old DEFs are never deleted. A reporter can replay any past `rule_set_version` against the log to see what the system thought at that point in time.

---

## Stage 7 — UI surfaces for the loop

### Stage 7a — Per-entity loop indicator

In the entity profile, a small status line:

> Loop · 47 DEFs · 42 confirms · 3 rejects · 2 reframes · last REC 2h ago (alias added)

Hover expands to a recent-events strip showing the last 10 DEF/EVA/REC events for this entity.

### Stage 7b — Pending EVA queue

Persistent badge in the workspace bar: *"12 model suggestions await review."*
Click opens a batch-review modal. Each suggestion shows: surface, context, proposed canonical entity, model rationale, three buttons (Confirm / Reject / Reframe). Reporter can rip through 50 in 60 seconds.

### Stage 7c — Ruleset changelog

Workspace settings → Ruleset history. Vertical timeline of every REC event:

> rs_v48 · 2h ago · alias_add · "Solaren Risk Management" → Solaren International · triggered by 3 confirmations · [revert]
> rs_v47 · 4h ago · prototype_update · Nashville Downtown Partnership · silent · [view]
> rs_v46 · 6h ago · threshold_lower · Solaren International (0.85 → 0.80) · [revert]

Each row links to the EVAs that triggered it. Reporters who distrust the automation audit here. Reporters who trust it never visit.

### Stage 7d — Resistance profile dashboard

A summary view per workspace:

- DEF rate (events per day)
- EVA rate, broken down by source (direct / inferred / system)
- REC rate, broken down by type
- Counter-REC rate (how often the system is reverting itself)
- Average time from DEF to first EVA
- Pending EVA count

Reporter can adjust trigger thresholds directly from this dashboard if the loop is moving too aggressively or too cautiously.

---

## Stage 8 — Failure mode prevention

Mapped to the loop document's three pathologies:

**Suppressed ⊛REC → sclerosis.** Prevented by Stage 3 automatic triggers. Accumulated EVA pressure cannot stagnate; trigger thresholds force rule rewrites.

**Skipped ⊨EVA → ideology.** Prevented by Stage 5 REC validation gate. RECs require EVA evidence; the system cannot rewrite rules from internal reasoning alone.

**Skipped ⊢DEF → chaos.** Prevented by Stage 1 ruleset versioning. New rulesets don't invalidate old DEFs; reporters never see categories destabilize beneath them.

---

## The model's actual job, one sentence

**The model proposes definitions constrained by the current ruleset. The reporter evaluates them. The ruleset rewrites itself when evaluation pressure accumulates. Nothing else happens.**

If a proposed feature puts the model outside that sentence — generating article text, answering questions, ranking results, mutating definitions without EVA evidence — it's in a different pipeline and has to be spec'd separately under its own operator discipline. This pipeline is ⊢DEF → ⊨EVA → ⊛REC, fully closed, continuously learning, structurally preserved across every model version, reporter correction, and workspace expansion that follows.
