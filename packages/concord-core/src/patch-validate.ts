import {
  matchFactKey,
  type FactClaim,
  type PatchProposal,
  type PatchValidation,
} from "@relay/contracts";
import { runExtractors } from "./extractors.js";
import { sha256Hex } from "./hash.js";
import type { DocUnit } from "./types.js";

/**
 * The four mandatory validation gates (contracts.md §14) plus the path
 * allowlist (security.md §4.3). Mechanical, pure, unit-tested — "the prompt
 * says not to invent facts" is not a control (invariant I6 / AP5).
 */

/** security.md §4.3 — denylist checked FIRST and independently. */
const PATH_DENYLIST: readonly RegExp[] = [
  /(^|\/)\.[^/]*($|\/)/, // any dotfile or dot-directory (incl. .github)
  /\.(ts|tsx|js|py|sql|sh|ps1|yml|yaml|pem)$/i,
  /(^|\/)Dockerfile$/,
  /(^|\/)package\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /\.env[^/]*$/i,
];

/** security.md §4.3 — writes permitted ONLY under these. */
const PATH_ALLOWLIST: readonly RegExp[] = [
  /^docs-mintlify\/([^/]+\/)*[^/]+\.mdx$/,
  /^docs-mintlify\/docs\.json$/,
  /^docs-mintlify\/generated\/.+$/,
  /^help-center\/([^/]+\/)*[^/]+\.md$/,
  /^help-center\/index\.json$/,
  /^in-product-copy\/[^/]+\.json$/,
];

/** Traversal / encoding defenses, before any list is consulted. */
function pathIsSane(path: string): boolean {
  if (path.length === 0 || path.length > 512) return false;
  if (path.includes("\\")) return false; // backslashes never legal
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return false; // absolute
  if (path.split("/").some((seg) => seg === ".." || seg === "." || seg === "")) return false;
  if (/%2e|%2f|%5c/i.test(path)) return false; // URL-encoded traversal
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(path)) return false; // control characters
  if (path !== path.normalize("NFC")) return false; // unicode normalization tricks
  return true;
}

/** True only when the path is sane, not denied, and explicitly allowed. */
export function pathAllowlisted(path: string): boolean {
  if (!pathIsSane(path)) return false;
  if (PATH_DENYLIST.some((re) => re.test(path))) return false;
  return PATH_ALLOWLIST.some((re) => re.test(path));
}

/** §4.2 dangerous-content subset for model-authored bodies (full Change-Lab
 * filter arrives in Phase 17). MDX is executable — treat bodies as code. */
export function bodyContentSafe(body: string): boolean {
  if (/<\s*(script|iframe|object|embed)\b/i.test(body)) return false;
  if (/\bon[a-z]+\s*=/i.test(body)) return false;
  if (/javascript:/i.test(body)) return false;
  if (/^(import|export)\s/m.test(body)) return false;
  return true;
}

export type PatchVerdict =
  | {
      ok: true;
      validation: PatchValidation;
    }
  | {
      ok: false;
      reason: string;
      /** Gate (a) failures reclassify the impact; others just reject. */
      reclassify_to: "UNRESOLVED_CONFLICT" | null;
      /** structure/meaning risk forces the editorial path instead. */
      force_editorial: boolean;
    };

export interface ValidatePatchInput {
  proposal: PatchProposal;
  unit: DocUnit;
  /** Current snapshot facts — evidence locators must resolve here. */
  facts: readonly FactClaim[];
  detectedAt: string;
}

/**
 * All four gates, in order. Every failure names its gate; nothing warns.
 */
export function validatePatch(input: ValidatePatchInput): PatchVerdict {
  const { proposal, unit, facts } = input;

  // Gate (a): evidence present AND every locator resolves in the snapshot.
  if (proposal.evidence.length < 1) {
    return {
      ok: false,
      reason: "gate_a: zero evidence — a patch without evidence is worthless",
      reclassify_to: "UNRESOLVED_CONFLICT",
      force_editorial: false,
    };
  }
  for (const evidence of proposal.evidence) {
    const claim = facts.find((f) => f.key === evidence.fact_key);
    if (!claim || claim.locator !== evidence.locator) {
      return {
        ok: false,
        reason:
          `gate_a: evidence locator unresolvable in the current snapshot ` +
          `(${evidence.fact_key} @ ${evidence.locator}) — discarding the patch`,
        reclassify_to: "UNRESOLVED_CONFLICT",
        force_editorial: false,
      };
    }
  }

  // Gate (b): anti-hallucination — run the Phase-12 extractors over the new
  // body; a fact key not in the evidence set means the model asserted
  // something it was not given. Mechanical, not model-judged (AP5).
  const evidenceKeys = new Set(proposal.evidence.map((e) => e.fact_key));
  const syntheticUnit: DocUnit = {
    ...unit,
    body: proposal.new_body,
    body_sha256: sha256Hex(proposal.new_body),
  };
  const { projections } = runExtractors([syntheticUnit], facts, input.detectedAt);
  for (const projection of projections) {
    if (matchFactKey(projection.fact_key) === null) continue;
    if (!evidenceKeys.has(projection.fact_key)) {
      // Keys the ORIGINAL body already asserted are not new facts.
      const preExisting = runExtractors([unit], facts, input.detectedAt).projections.some(
        (p) => p.fact_key === projection.fact_key,
      );
      if (preExisting) continue;
      return {
        ok: false,
        reason: `gate_b: new body asserts ${projection.fact_key}, which is not in the evidence set (anti-hallucination)`,
        reclassify_to: null,
        force_editorial: false,
      };
    }
  }

  // Content safety subset of §4.2 — model bodies are untrusted code input.
  if (!bodyContentSafe(proposal.new_body)) {
    return {
      ok: false,
      reason: "gate_b: body contains executable/dangerous MDX constructs",
      reclassify_to: null,
      force_editorial: false,
    };
  }

  // Gate (d): the target path — from the DocUnit, never the model — must be
  // allowlisted (security.md §4.3).
  if (!pathAllowlisted(unit.path)) {
    return {
      ok: false,
      reason: `gate_d: path not allowlisted: ${unit.path}`,
      reclassify_to: null,
      force_editorial: false,
    };
  }

  // editorial_risk of structure/meaning forces EDITORIAL_REVIEW regardless.
  if (proposal.editorial_risk === "structure" || proposal.editorial_risk === "meaning") {
    return {
      ok: false,
      reason: `editorial_risk ${proposal.editorial_risk} — forced to EDITORIAL_REVIEW`,
      reclassify_to: null,
      force_editorial: true,
    };
  }

  // Gate (c) is structural: the caller stamps requires_review true for every
  // model-origin patch; validation records it and no apply path exists.
  return {
    ok: true,
    validation: {
      evidence_resolvable: true,
      introduces_no_new_facts: true,
      respects_editorial_register: true,
      path_allowlisted: true,
      falsification: { attempted: false, refuted: false, refutation: null }, // Phase 15
    },
  };
}
