/**
 * The single workspace-scoping rule (expansion architecture.md §3). Every
 * route decision about demo ownership goes through these two functions —
 * there is deliberately no second place where the rule could drift.
 *
 * Owner classes with API semantics:
 *   'vis_…'  — the visitor that created the row (readable/mutable by them);
 *   'seed'   — deployed demo content (readable by everyone, immutable).
 * NULL has NO semantics: rows created before scoping shipped are invisible
 * and unreachable; the Phase-2 maintenance reset deletes them.
 */

export const SEED_OWNER = "seed";

export function canRead(ownerId: string | null, visitorId: string): boolean {
  return ownerId === visitorId || ownerId === SEED_OWNER;
}

export type MutateDecision = "ok" | "seed_read_only" | "not_found";

/**
 * `not_found` (never a 403) for foreign or NULL owners: a 403 would confirm
 * the resource exists, and demo ids must not leak existence across visitors.
 * Seed rows are the one honest 403 — everyone can see them, nobody may
 * change them.
 */
export function canMutate(
  ownerId: string | null,
  visitorId: string,
): MutateDecision {
  if (ownerId === visitorId) return "ok";
  if (ownerId === SEED_OWNER) return "seed_read_only";
  return "not_found";
}
