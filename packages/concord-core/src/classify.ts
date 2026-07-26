import type { ActionClass } from "@relay/contracts";
import type { FactDelta, FactProjection } from "./types.js";
import { sameValue } from "./normalize-value.js";

/**
 * architecture.md §6.1, implemented literally — first matching rule wins.
 * Phase 10 implements rules 2, 3, and 6; rules 1, 4, and 5 exist in the
 * type but are EXPLICIT unreachable branches here, never silent
 * fallthrough. Guard (contracts.md §12): model_extraction can never drive a
 * deterministic action — enforced in code, not convention.
 */
export interface Classification {
  action: ActionClass;
  rule: number;
}

export function classify(
  projection: FactProjection,
  delta: FactDelta,
): Classification {
  if (
    projection.extractor === "model_extraction" &&
    (projection.mode === "generated" || projection.mode === "mechanical_value")
  ) {
    throw new Error(
      `I5 violation: model_extraction projection ${projection.id} cannot drive a deterministic action`,
    );
  }

  // Rule 1 — conflicting authoritative claims / unresolvable evidence.
  // TODO(phase-13): conflict detection needs the multi-tier evidence model;
  // unreachable in Phase 10 (one snapshot, one authoritative claim per key).

  // Rule 6 is checked before the regen rules so an already-correct unit is
  // NO_ACTION even when its projection mode would otherwise regen.
  if (
    projection.asserted_value !== null &&
    sameValue(projection.asserted_value, delta.to)
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

  if (projection.mode === "derived_prose") {
    // TODO(phase-13): rule 4 (GROUNDED_PATCH) needs the evidence pipeline.
    throw new Error(
      `TODO(phase-13): rule 4 (derived_prose → GROUNDED_PATCH) not built in Phase 10 — projection ${projection.id}`,
    );
  }
  // TODO(phase-13): rule 5 (editorial / IA change / human owner).
  throw new Error(
    `TODO(phase-13): rule 5 (editorial → EDITORIAL_REVIEW) not built in Phase 10 — projection ${projection.id}`,
  );
}
