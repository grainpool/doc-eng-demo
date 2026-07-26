import {
  matchFactKey,
  type ConflictDraft,
  type Evidence,
  type FactClaim,
} from "@relay/contracts";
import { arbitrateAll } from "./authority.js";
import { sameNormalized, unitOfFactKey } from "./normalize-value.js";
import type { DocUnit } from "./types.js";

/**
 * Conflict detection (contracts.md §15) — all five kinds. Concord NEVER
 * resolves a conflict: not with a heuristic, not with a tiebreak, not with
 * "the newer source wins". `resolution` is null by type (invariant I7).
 * Every conflict names its likely owner (FACT_REGISTRY), what information
 * would resolve it, and a question you would actually put to that owner.
 */

function toEvidence(claim: FactClaim): Evidence;
function toEvidence(claim: { key: string; value: unknown; tier: Evidence["tier"]; locator: string; observed_at?: string }): Evidence;
function toEvidence(claim: {
  key: string;
  value: unknown;
  tier: Evidence["tier"];
  locator: string;
  observed_at?: string;
}): Evidence {
  return {
    fact_key: claim.key,
    tier: claim.tier,
    locator: claim.locator,
    value: claim.value,
    observed_at: claim.observed_at ?? "",
  };
}

function ownerOf(key: string): string {
  return matchFactKey(key)?.owner ?? "unowned";
}

/** authority_disagreement + ambiguous_ownership (T5 double claim). */
function arbitrationConflicts(facts: readonly FactClaim[]): ConflictDraft[] {
  const drafts: ConflictDraft[] = [];
  const byKey = new Map<string, FactClaim[]>();
  for (const fact of facts) {
    byKey.set(fact.key, [...(byKey.get(fact.key) ?? []), fact]);
  }
  for (const [, arbitration] of arbitrateAll(facts)) {
    for (const conflict of arbitration.conflicts) {
      const key = conflict.fact_key;
      const claims: Evidence[] = [];
      if (arbitration.authoritative) {
        claims.push(
          toEvidence({
            key,
            value: arbitration.authoritative.value,
            tier: arbitration.authoritative.tier,
            locator: arbitration.authoritative.source,
          }),
        );
      }
      claims.push(
        toEvidence({
          key,
          value: conflict.claim.value,
          tier: conflict.claim.tier,
          locator: conflict.claim.source,
        }),
      );
      if (claims.length < 2) continue;
      const owner = ownerOf(key);
      if (conflict.kind === "t5_double_claim") {
        drafts.push({
          fact_key: key,
          kind: "ambiguous_ownership",
          claims,
          missing_information: [
            `Which of the two decision records is the standing one for ${key}`,
            "A single decision record superseding the other, or a retraction",
          ],
          likely_owner: owner,
          suggested_question:
            `Two decision records claim ${key} with different positions. ` +
            `Which one stands, and can the other be marked superseded?`,
          resolution: null,
        });
      } else {
        drafts.push({
          fact_key: key,
          kind: "authority_disagreement",
          claims,
          missing_information: [
            `Confirmation of the current value of ${key} from its authoritative tier`,
            "A correction or removal of the disagreeing claim at its source",
          ],
          likely_owner: owner,
          suggested_question:
            `${key} is claimed with different values by different sources ` +
            `(${claims.map((c) => `${c.tier}: ${JSON.stringify(c.value)}`).join(" vs ")}). ` +
            `Which value is correct, and should the other source be fixed?`,
          resolution: null,
        });
      }
    }
  }
  return drafts;
}

/** temporal_contradiction: a T4 transition inconsistent with the current
 * authoritative value — the record is retained (T4 is temporal), and the
 * DISAGREEMENT is escalated, never auto-resolved. */
function temporalContradictions(facts: readonly FactClaim[]): ConflictDraft[] {
  const drafts: ConflictDraft[] = [];
  const currentByKey = new Map(
    facts
      .filter((f) => f.tier !== "T4_RELEASE" && f.tier !== "T5_HUMAN")
      .map((f) => [f.key, f]),
  );
  // Only the LATEST transition per key can contradict the present.
  const latestTransition = new Map<
    string,
    { from: unknown; to: unknown; releaseKey: string; locator: string; released_at: string }
  >();
  for (const fact of facts) {
    if (fact.tier !== "T4_RELEASE") continue;
    const record = fact.value as {
      released_at?: string;
      changes?: { fact_key: string; from: unknown; to: unknown }[];
    } | null;
    for (const change of record?.changes ?? []) {
      const existing = latestTransition.get(change.fact_key);
      const releasedAt = record?.released_at ?? "";
      if (!existing || existing.released_at < releasedAt) {
        latestTransition.set(change.fact_key, {
          from: change.from,
          to: change.to,
          releaseKey: fact.key,
          locator: fact.locator,
          released_at: releasedAt,
        });
      }
    }
  }
  for (const [key, transition] of latestTransition) {
    const entry = matchFactKey(key);
    const current = currentByKey.get(key);
    if (!entry || !current) continue;
    const same = (a: unknown, b: unknown): boolean =>
      entry.valueType === "json"
        ? JSON.stringify(a) === JSON.stringify(b)
        : sameNormalized(a, b, entry.valueType, unitOfFactKey(key));
    if (same(transition.to, current.value)) continue; // the transition holds
    // A value that moved BEYOND the last release (matches neither from nor
    // to) is a missing release record, not a contradiction — the change is
    // real, just unrecorded. The contradiction is the announced-but-absent
    // transition: the current value still equals the release's FROM.
    if (!same(transition.from, current.value)) continue;
    drafts.push({
      fact_key: key,
      kind: "temporal_contradiction",
      claims: [
        toEvidence(current),
        toEvidence({
          key,
          value: transition.to,
          tier: "T4_RELEASE",
          locator: transition.locator,
          observed_at: transition.released_at,
        }),
      ],
      missing_information: [
        `Whether the announced transition of ${key} to ${JSON.stringify(transition.to)} was rolled back or never shipped`,
        "A release record for the rollback, or a decision record standing by the current value",
      ],
      likely_owner: ownerOf(key),
      suggested_question:
        `Release ${transition.releaseKey} announced ${key} → ${JSON.stringify(transition.to)}, ` +
        `but the current authoritative value is ${JSON.stringify(current.value)}. ` +
        `Was this rolled back? Should the docs describe it as unavailable, and is a rollback release record needed?`,
      resolution: null,
    });
  }
  return drafts;
}

/** circular_reference: unit A cites B as its source and B cites A. A "cite"
 * is a markdown link whose surrounding text marks it as a source. */
const CITE_PATTERN = /\b(?:source|per|according to|as documented in):?\s*\[[^\]]*\]\(([^)#\s]+)[^)]*\)/gi;

function citesOf(unit: DocUnit): string[] {
  return [...unit.body.matchAll(CITE_PATTERN)].map((m) => (m[1] as string).replace(/^\//, ""));
}

function pageOf(unit: DocUnit): string {
  const file = unit.path.split("/").pop() ?? unit.path;
  return file.replace(/\.(mdx?|json)$/, "");
}

export function circularReferences(units: readonly DocUnit[]): ConflictDraft[] {
  const drafts: ConflictDraft[] = [];
  const byPage = new Map<string, DocUnit[]>();
  for (const unit of units) {
    const page = pageOf(unit);
    byPage.set(page, [...(byPage.get(page) ?? []), unit]);
  }
  const seen = new Set<string>();
  for (const unit of units) {
    for (const cited of citesOf(unit)) {
      const citedPage = cited.split("/").pop() ?? cited;
      for (const citedUnit of byPage.get(citedPage) ?? []) {
        const backCites = citesOf(citedUnit).some(
          (c) => (c.split("/").pop() ?? c) === pageOf(unit),
        );
        if (!backCites) continue;
        const pairKey = [unit.path, citedUnit.path].sort().join("↔");
        if (seen.has(pairKey) || unit.path === citedUnit.path) continue;
        seen.add(pairKey);
        drafts.push({
          fact_key: `doc.circular.${pageOf(unit)}.${citedPage}`,
          kind: "circular_reference",
          claims: [
            toEvidence({
              key: unit.id,
              value: `cites ${citedPage} as source`,
              tier: "T5_HUMAN",
              locator: unit.path,
            }),
            toEvidence({
              key: citedUnit.id,
              value: `cites ${pageOf(unit)} as source`,
              tier: "T5_HUMAN",
              locator: citedUnit.path,
            }),
          ],
          missing_information: [
            "Which document is the actual source of truth for the shared claim",
            "An authoritative fact key both pages can cite instead of each other",
          ],
          likely_owner: unit.owner,
          suggested_question:
            `${unit.path} and ${citedUnit.path} cite each other as the source. ` +
            `Which one owns the claim — or should both cite a product-truth fact key instead?`,
          resolution: null,
        });
      }
    }
  }
  return drafts;
}

/** insufficient_evidence: built by the caller when required evidence cannot
 * be resolved (patch gate a). Kept here so every conflict shape lives in
 * one module. */
export function insufficientEvidenceConflict(
  factKey: string,
  attemptedLocator: string,
  facts: readonly FactClaim[],
): ConflictDraft {
  const nearest = facts.find((f) => f.key === factKey);
  const claims: Evidence[] = [
    toEvidence({
      key: factKey,
      value: nearest?.value ?? null,
      tier: nearest?.tier ?? "T5_HUMAN",
      locator: nearest?.locator ?? "(no claim in the current snapshot)",
      observed_at: nearest?.observed_at,
    }),
    toEvidence({
      key: factKey,
      value: "(evidence cited but unresolvable)",
      tier: "T5_HUMAN",
      locator: attemptedLocator,
    }),
  ];
  return {
    fact_key: factKey,
    kind: "insufficient_evidence",
    claims,
    missing_information: [
      `A resolvable authoritative claim for ${factKey} in the current snapshot`,
      `Why the cited locator (${attemptedLocator}) does not resolve`,
    ],
    likely_owner: ownerOf(factKey),
    suggested_question:
      `A change to ${factKey} needs evidence at ${attemptedLocator}, which does not resolve ` +
      `in the current product-truth snapshot. Where does the authoritative value live now?`,
    resolution: null,
  };
}

/** All snapshot-derivable conflicts (the caller adds insufficient_evidence
 * events from patch validation as they occur). */
export function detectConflicts(
  facts: readonly FactClaim[],
  units: readonly DocUnit[],
): ConflictDraft[] {
  return [
    ...arbitrationConflicts(facts),
    ...temporalContradictions(facts),
    ...circularReferences(units),
  ];
}
