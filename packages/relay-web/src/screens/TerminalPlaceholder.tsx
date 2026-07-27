import { t } from "../copy.js";

/** Honest empty state until Phase 5 ships the browser terminal. */
export function TerminalPlaceholder() {
  return (
    <section className="surface-reading">
      <h1>{t("nav.terminal")}</h1>
      <div className="card">
        <h3>{t("terminal.placeholder.title")}</h3>
        <p>{t("terminal.placeholder.body")}</p>
      </div>
    </section>
  );
}
