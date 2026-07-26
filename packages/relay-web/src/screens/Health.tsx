import { useEffect, useState } from "react";
import { t } from "../copy.js";

interface HealthCheck {
  ok: boolean;
  value: string;
  duration_ms: number;
}

interface HealthReport {
  request_id: string;
  generated_at: string;
  all_ok: boolean;
  checks: Record<string, HealthCheck>;
}

export function Health() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then(async (res) => setReport((await res.json()) as HealthReport))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section>
      <h1>{t("health.title")}</h1>
      <p>{t("health.intro")}</p>
      {loading && <p className="loading">{t("health.loading")}</p>}
      {failed && <p className="status-error">{t("error.generic.network")}</p>}
      {report && (
        <>
          <table>
            <tbody>
              {Object.entries(report.checks).map(([key, check]) => (
                <tr key={key}>
                  <td>{check.ok ? "✅" : "❌"}</td>
                  <td>{t(`health.check.${key}`)}</td>
                  <td>
                    <code>{check.value}</code>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    {t("health.duration", { ms: check.duration_ms })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className={report.all_ok ? "status-success" : "status-error"}>
            {t(report.all_ok ? "health.all_ok" : "health.not_ok")}
          </p>
        </>
      )}
    </section>
  );
}
