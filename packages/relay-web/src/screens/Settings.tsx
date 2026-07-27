import { useEffect, useState } from "react";
import { t } from "../copy.js";
import { Health } from "./Health.js";

interface TruthFacts {
  relay_contracts_version?: string;
  facts: { key: string; value: unknown }[];
}

// Machine identifiers rendered verbatim (fact keys are not UI copy).
const CONTRACTS_VERSION_KEY = "relay_contracts_version";
const DISPLAY_FACT_KEYS = [
  "availability.feature.chat.platform.web",
  "availability.feature.terminal.platform.web",
  "runtime.python.version",
];

/**
 * Settings / product information (expansion Phase 3): the workspace privacy
 * model, product facts straight from the product-truth snapshot (single
 * source — never re-typed), and the existing health check.
 */
export function Settings() {
  const [truth, setTruth] = useState<TruthFacts | null>(null);

  useEffect(() => {
    fetch("/api/product-truth")
      .then((r) => r.json() as Promise<TruthFacts>)
      .then(setTruth)
      .catch(() => setTruth(null));
  }, []);

  const fact = (key: string): string => {
    const found = truth?.facts.find((f) => f.key === key);
    return found === undefined ? "…" : String(found.value);
  };

  return (
    <section>
      <h1>{t("nav.settings")}</h1>

      <h2>{t("workspace.banner.label")}</h2>
      <p>{t("workspace.banner")}</p>

      <h2>{t("settings.about.heading")}</h2>
      <p>{t("settings.terminology")}</p>
      <p>{t("settings.retention.artifacts")}</p>
      <p>{t("settings.retention.uploads")}</p>
      <p>{t("settings.availability.sessions")}</p>
      <p>{t("settings.plan.sessions")}</p>
      {truth && (
        <table>
          <thead>
            <tr>
              <th>{t("settings.facts.key")}</th>
              <th>{t("settings.facts.value")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <code>{CONTRACTS_VERSION_KEY}</code>
              </td>
              <td>{truth.relay_contracts_version ?? "…"}</td>
            </tr>
            {DISPLAY_FACT_KEYS.map((key) => (
              <tr key={key}>
                <td>
                  <code>{key}</code>
                </td>
                <td>{fact(key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>{t("settings.health.link")}</h2>
      <Health />
    </section>
  );
}
