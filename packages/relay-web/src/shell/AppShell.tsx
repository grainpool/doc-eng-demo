import { useState, type ReactNode } from "react";
import { t } from "../copy.js";
import { NAV_SECTIONS, type Section } from "./routes.js";

/**
 * The multi-surface shell (expansion Phase 3): persistent sidebar navigation
 * on wide viewports, a toggleable menu under 720px. Pure chrome — surfaces
 * render into the main region with their own width class.
 */
export function AppShell({
  section,
  width,
  children,
}: {
  section: Section;
  width: string;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="shell">
      <header className="shell-sidebar">
        <a className="shell-brand" href="#/chat">
          {t("app.title")}
        </a>
        <button
          type="button"
          className="btn-secondary shell-menu-toggle"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {t("nav.menu")}
        </button>
        <nav className={menuOpen ? "shell-nav open" : "shell-nav"}>
          {NAV_SECTIONS.map((item) => (
            <a
              key={item.section}
              href={item.href}
              aria-current={item.section === section ? "page" : undefined}
              onClick={() => setMenuOpen(false)}
            >
              {t(item.copyId)}
            </a>
          ))}
        </nav>
      </header>
      <main className="shell-main content">
        <div className={width}>{children}</div>
      </main>
    </div>
  );
}
