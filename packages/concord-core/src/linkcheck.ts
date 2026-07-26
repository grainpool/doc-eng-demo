import type { DocUnit, Finding } from "./types.js";

/**
 * Repo-INTERNAL link and anchor resolution (validation.md: BROKEN_REF is
 * validated within the estate only — no server component ever fetches an
 * external URL, security.md §1). External links are out of scope by design.
 */

const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

export function checkInternalLinks(units: readonly DocUnit[]): Finding[] {
  // Mintlify routes: /<page> from docs-mintlify/<page>.mdx; anchors are the
  // per-unit slugs. Help-center relative links resolve within help-center/.
  const mintlifyPages = new Map<string, Set<string>>(); // page → anchors
  const estatePaths = new Set(units.map((u) => u.path));
  for (const unit of units) {
    if (unit.surface !== "mintlify" && unit.surface !== "generated") continue;
    const page = (unit.path.split("/").pop() ?? "").replace(/\.mdx$/, "");
    if (!mintlifyPages.has(page)) mintlifyPages.set(page, new Set());
    if (unit.anchor) mintlifyPages.get(page)!.add(unit.anchor);
  }
  const findings: Finding[] = [];
  for (const unit of units) {
    for (const match of unit.body.matchAll(LINK)) {
      const target = match[1] as string;
      if (/^(https?:|mailto:)/i.test(target)) continue; // external: out of scope
      let broken = false;
      let reason = "";
      if (target.startsWith("/")) {
        const [page, anchor] = target.slice(1).split("#");
        if (page && !mintlifyPages.has(page)) {
          broken = true;
          reason = `page /${page} does not exist in the estate`;
        } else if (page && anchor && !mintlifyPages.get(page)!.has(anchor)) {
          broken = true;
          reason = `anchor #${anchor} does not exist on /${page}`;
        }
      } else if (target.startsWith("./") || target.endsWith(".md")) {
        const base = unit.path.split("/").slice(0, -1).join("/");
        const resolved = `${base}/${target.replace(/^\.\//, "")}`.split("#")[0] as string;
        if (!estatePaths.has(resolved)) {
          broken = true;
          reason = `relative target ${resolved} does not exist in the estate`;
        }
      }
      if (broken) {
        findings.push({
          kind: "broken_ref",
          fact_key: `doc.link.${target}`,
          doc_unit_id: unit.id,
          projection_id: null,
          detail: `${unit.id} links to ${target}, but ${reason}`,
          owner: unit.owner,
        });
      }
    }
  }
  return findings;
}
