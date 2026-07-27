/**
 * The hash route table (expansion Phase 3). One place declares every surface:
 * its match, its nav section (for aria-current), and its content width class.
 * Old pre-shell URLs are REDIRECTS, never broken: #/sessions/:id moved under
 * Analysis, #/health under Settings, and the bare root lands on Chat.
 */

export type Section =
  | "chat"
  | "projects"
  | "analysis"
  | "terminal"
  | "artifacts"
  | "settings";

export interface RouteMatch {
  screen:
    | { kind: "chat" }
    | { kind: "projects" }
    | { kind: "project"; id: string }
    | { kind: "analysis" }
    | { kind: "session"; id: string }
    | { kind: "terminal" }
    | { kind: "artifacts" }
    | { kind: "artifact"; id: string }
    | { kind: "settings" };
  section: Section;
  /** Content column class: reading (~72ch), wide (tables/results), fluid. */
  width: "surface-reading" | "surface-wide" | "surface-fluid";
}

const ID = "([a-z0-9_]+)";

export function resolveRoute(hash: string): RouteMatch | { redirect: string } {
  if (hash === "" || hash === "#" || hash === "#/") return { redirect: "#/chat" };
  const legacySession = new RegExp(`^#/sessions/${ID}$`).exec(hash);
  if (legacySession) return { redirect: `#/analysis/sessions/${legacySession[1]}` };
  if (hash === "#/health") return { redirect: "#/settings" };

  if (hash === "#/chat") return { screen: { kind: "chat" }, section: "chat", width: "surface-reading" };
  if (hash === "#/projects") return { screen: { kind: "projects" }, section: "projects", width: "surface-reading" };
  const project = new RegExp(`^#/projects/${ID}$`).exec(hash);
  if (project) {
    return { screen: { kind: "project", id: project[1] as string }, section: "projects", width: "surface-wide" };
  }
  if (hash === "#/analysis") return { screen: { kind: "analysis" }, section: "analysis", width: "surface-reading" };
  const session = new RegExp(`^#/analysis/sessions/${ID}$`).exec(hash);
  if (session) {
    return { screen: { kind: "session", id: session[1] as string }, section: "analysis", width: "surface-wide" };
  }
  if (hash === "#/terminal") return { screen: { kind: "terminal" }, section: "terminal", width: "surface-fluid" };
  if (hash === "#/artifacts") return { screen: { kind: "artifacts" }, section: "artifacts", width: "surface-wide" };
  const artifact = new RegExp(`^#/artifacts/${ID}$`).exec(hash);
  if (artifact) {
    return { screen: { kind: "artifact", id: artifact[1] as string }, section: "artifacts", width: "surface-wide" };
  }
  if (hash === "#/settings") return { screen: { kind: "settings" }, section: "settings", width: "surface-reading" };

  return { redirect: "#/chat" };
}

export const NAV_SECTIONS: { section: Section; href: string; copyId: string }[] = [
  { section: "chat", href: "#/chat", copyId: "nav.chat" },
  { section: "projects", href: "#/projects", copyId: "nav.projects" },
  { section: "analysis", href: "#/analysis", copyId: "nav.analysis" },
  { section: "terminal", href: "#/terminal", copyId: "nav.terminal" },
  { section: "artifacts", href: "#/artifacts", copyId: "nav.artifacts" },
  { section: "settings", href: "#/settings", copyId: "nav.settings" },
];
