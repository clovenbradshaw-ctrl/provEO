/* ======================================================================
   RULESET VERSIONING (Stage 1 supporting infrastructure)
   ----------------------------------------------------------------------
   Every DEF event carries the rule_set_version under which it was
   produced. Stage 3 ⊛REC events bump the version; Stage 6 revalidation
   later replays old DEFs against newer rulesets. For Stage 1 we
   bootstrap at rs_v1 — REC-class bumps land with the ⊛REC pipeline.
====================================================================== */

const INITIAL_RULESET_VERSION = 'rs_v1';
let RULE_SET_VERSION = INITIAL_RULESET_VERSION;

function currentRuleSetVersion() {
  return RULE_SET_VERSION;
}

function bumpRuleSetVersion() {
  const n = parseInt(RULE_SET_VERSION.replace(/^rs_v/, ''), 10) + 1;
  RULE_SET_VERSION = `rs_v${Number.isFinite(n) ? n : 2}`;
  return RULE_SET_VERSION;
}
