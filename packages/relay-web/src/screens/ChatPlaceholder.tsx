import { t } from "../copy.js";

/** Honest empty state until Phase 4 ships the real surface — the copy
 *  references the availability fact, which is still false. */
export function ChatPlaceholder() {
  return (
    <section>
      <h1>{t("nav.chat")}</h1>
      <div className="card">
        <h3>{t("chat.placeholder.title")}</h3>
        <p>{t("chat.placeholder.body")}</p>
        <p>
          <a href="#/analysis">{t("nav.analysis")}</a>
        </p>
      </div>
      <p className="empty">{t("workspace.banner")}</p>
    </section>
  );
}
