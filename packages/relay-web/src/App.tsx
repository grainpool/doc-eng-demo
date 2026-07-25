import { useEffect, useState } from "react";

interface HealthCheck {
  ok: boolean;
  value: string;
  duration_ms: number;
  detail?: Record<string, string>;
}

interface HealthReport {
  request_id: string;
  generated_at: string;
  all_ok: boolean;
  checks: Record<string, HealthCheck>;
  duration_ms: number;
}

const CHECK_LABELS: Record<string, string> = {
  worker_assets: "Worker + static assets",
  d1: "D1 write → read",
  r2: "R2 put → get",
  kernel: "Container kernel (pandas)",
  anthropic: "Anthropic API",
};

export function App() {
  const [report, setReport] = useState<HealthReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/health")
      .then(async (res) => {
        setReport((await res.json()) as HealthReport);
      })
      .catch(() => setError("Could not reach /api/health"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "3rem auto", padding: "0 1rem" }}>
      <h1 style={{ fontSize: "1.4rem" }}>Relay — walking skeleton</h1>
      <p style={{ color: "#555" }}>
        Phase 01: every external dependency, proven live. This page and the API
        below are served by the same Worker.
      </p>
      {loading && <p>Running checks (a cold container start can take a minute)…</p>}
      {error && <p style={{ color: "#b00" }}>{error}</p>}
      {report && (
        <>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {Object.entries(report.checks).map(([key, check]) => (
                <tr key={key} style={{ borderBottom: "1px solid #ddd" }}>
                  <td style={{ padding: "0.5rem 0" }}>{check.ok ? "✅" : "❌"}</td>
                  <td style={{ padding: "0.5rem" }}>{CHECK_LABELS[key] ?? key}</td>
                  <td style={{ padding: "0.5rem", fontFamily: "monospace" }}>{check.value}</td>
                  <td style={{ padding: "0.5rem", color: "#888", textAlign: "right" }}>
                    {check.duration_ms} ms
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ color: "#888", fontSize: "0.85rem" }}>
            {report.all_ok ? "All five links green." : "At least one link is down."}{" "}
            Generated {report.generated_at} · request {report.request_id}
          </p>
        </>
      )}
    </main>
  );
}
