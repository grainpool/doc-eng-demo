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

/**
 * SQL fragment for read-scoped queries. Callers append it with AND and push
 * `visitorId` as the bound param: `AND ${READ_SCOPE_SQL}` — one spelling of
 * the rule for direct project queries and one for child-table joins.
 */
export const READ_SCOPE_SQL = "(owner_id = ? OR owner_id = 'seed')";
export const READ_SCOPE_JOIN_SQL = "(p.owner_id = ? OR p.owner_id = 'seed')";

export interface OwnedProjectRow {
  id: string;
  owner_id: string | null;
  state: string;
}

export type ProjectAccess =
  | { kind: "ok"; project: OwnedProjectRow }
  | { kind: "not_found" }
  | { kind: "seed_read_only" }
  | { kind: "archived"; project: OwnedProjectRow };

/** Load a project for a MUTATION: ownership then (optionally) active state. */
export async function projectForWrite(
  db: D1Database,
  projectId: string,
  visitorId: string,
  opts: { requireActive: boolean } = { requireActive: true },
): Promise<ProjectAccess> {
  const project = await db
    .prepare("SELECT id, owner_id, state FROM project WHERE id = ?")
    .bind(projectId)
    .first<OwnedProjectRow>();
  if (!project) return { kind: "not_found" };
  const decision = canMutate(project.owner_id, visitorId);
  if (decision === "seed_read_only") return { kind: "seed_read_only" };
  if (decision === "not_found") return { kind: "not_found" };
  if (opts.requireActive && project.state !== "active") {
    return { kind: "archived", project };
  }
  return { kind: "ok", project };
}
