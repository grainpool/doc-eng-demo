import type { ActionClass } from "@relay/contracts";
import type { Arbitration } from "./authority.js";
import type { DocUnit, FactDelta, FactProjection, Impact } from "./types.js";
import { sameValue } from "./normalize-value.js";

/**
 * architecture.md §6.1, implemented literally — ALL SIX RULES (Phase 13),
 * first matching rule wins. No model call in this step (constraints.md AP3):
 * the model never decides between auto-apply and escalate.
 *
 * Ordering nuance (unchanged from Phase 10, exercised by the milestone
 * test): value-equality (rule 6) is checked before the regen rules so an
 * already-correct unit is NO_ACTION rather than a no-op regeneration. The
 * table's rule numbers are still recorded faithfully.
 *
 * Guard (contracts.md §12 / invariant I5): a model_extraction projection can
 * NEVER drive a deterministic action — enforced in code, not convention.
 */
export interface Classification {
  action: ActionClass;
  rule: number;
}

export interface ClassifyContext {
  projection: FactProjection;
  delta: FactDelta;
  unit: DocUnit;
  /** Arbitration for this fact key over the CURRENT snapshot. */
  arbitration: Arbitration | null;
}

/** Owners that are systems, not people. Every other owner is a human role. */
const SYSTEM_OWNERS = new Set(["concord"]);

/** Delta kinds that imply an information-architecture change (rule 5). */
const IA_DELTA_KINDS = new Set([
  "prerequisite_added",
  "page_split",
  "page_merged",
  "task_flow_changed",
]);

/** Delta kinds rule 4 may ground a patch on. */
const VALUE_DELTA_KINDS = new Set(["value_changed", "availability_changed"]);

export function classify(ctx: ClassifyContext): Classification {
  const { projection, delta, unit, arbitration } = ctx;

  if (
    projection.extractor === "model_extraction" &&
    (projection.mode === "generated" || projection.mode === "mechanical_value")
  ) {
    throw new Error(
      `I5 violation: model_extraction projection ${projection.id} cannot drive a deterministic action`,
    );
  }

  // Rule 1 — conflicting authoritative claims, or evidence that is missing
  // or unresolvable. Classified and blocked here; the conflict machinery
  // itself is Phase 15.
  const hasAuthorityConflict = (arbitration?.conflicts.length ?? 0) > 0;
  const evidenceUnresolvable =
    arbitration !== null && arbitration.authoritative === null;
  if (hasAuthorityConflict || evidenceUnresolvable) {
    return { action: "UNRESOLVED_CONFLICT", rule: 1 };
  }

  // Rule 6 (checked early; see module doc) — the asserted value already
  // equals the new value after normalization.
  if (
    projection.asserted_value !== null &&
    projection.asserted_value !== undefined &&
    sameValue(projection.normalized_value ?? projection.asserted_value, delta.to)
  ) {
    return { action: "NO_ACTION", rule: 6 };
  }

  // Rule 2 — generated projections are always deterministically regenerated.
  if (projection.mode === "generated") {
    return { action: "DETERMINISTIC_REGEN", rule: 2 };
  }

  // Rule 3 — unambiguous mechanical scalar substitution.
  if (
    projection.mode === "mechanical_value" &&
    projection.span !== null &&
    (typeof delta.to === "number" || typeof delta.to === "string")
  ) {
    return { action: "DETERMINISTIC_REGEN", rule: 3 };
  }

  // Rule 4 — derived prose over a value/availability change with a single
  // authoritative source: a grounded, review-required patch (Phase 14 path).
  if (
    projection.mode === "derived_prose" &&
    VALUE_DELTA_KINDS.has(delta.kind) &&
    arbitration?.authoritative !== null
  ) {
    return { action: "GROUNDED_PATCH", rule: 4 };
  }

  // Rule 5 — editorial mode, an IA-change delta, or a human-owned unit.
  if (
    projection.mode === "editorial" ||
    IA_DELTA_KINDS.has(delta.kind) ||
    !SYSTEM_OWNERS.has(unit.owner)
  ) {
    return { action: "EDITORIAL_REVIEW", rule: 5 };
  }

  // The table is exhaustive over real inputs; reaching here means a
  // system-owned unit with an unhandled mode/delta combination.
  throw new Error(
    `classification table exhausted for projection ${projection.id} (mode ${projection.mode}, delta ${delta.kind})`,
  );
}

/** Disposition per action class (constraints.md AP6: nothing dropped). */
export function dispositionFor(action: ActionClass): Impact["disposition"] {
  switch (action) {
    case "DETERMINISTIC_REGEN":
      return "proposed";
    case "NO_ACTION":
      return "no_action";
    case "GROUNDED_PATCH":
    case "EDITORIAL_REVIEW":
    case "UNRESOLVED_CONFLICT":
      return "unresolved";
  }
}
