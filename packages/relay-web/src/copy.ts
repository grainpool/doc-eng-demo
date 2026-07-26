/**
 * The copy registry, imported at build time from the estate submodule
 * (architecture.md §5: in-product copy is a documentation surface Concord
 * reconciles; it reaches this app only through the submodule pin). Every
 * user-visible string in relay-web renders through t() — a hardcoded JSX
 * string is a lint/test failure (constraints.md AP8).
 */
import errors from "../../../estate/in-product-copy/errors.json";
import projects from "../../../estate/in-product-copy/projects.json";
import files from "../../../estate/in-product-copy/files.json";
import health from "../../../estate/in-product-copy/health.json";
import sessionsCopy from "../../../estate/in-product-copy/sessions.json";

export interface CopyEntry {
  id: string;
  kind: string;
  text: string;
  surface_location: string;
}

const ALL_ENTRIES: CopyEntry[] = [
  ...errors.entries,
  ...projects.entries,
  ...files.entries,
  ...health.entries,
  ...sessionsCopy.entries,
];

const BY_ID = new Map(ALL_ENTRIES.map((e) => [e.id, e]));

export function t(id: string, vars?: Record<string, string | number>): string {
  const entry = BY_ID.get(id);
  // A missing id renders as the raw id — loudly wrong on screen, never silent.
  if (!entry) return id;
  return entry.text.replace(/\{(\w+)\}/g, (whole, name: string) =>
    vars && name in vars ? String(vars[name]) : whole,
  );
}

export function copyIds(): string[] {
  return ALL_ENTRIES.map((e) => e.id);
}
