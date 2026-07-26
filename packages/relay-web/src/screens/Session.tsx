import { useEffect, useState } from "react";
import {
  api,
  ApiFault,
  streamNarration,
  type ArtifactSummary,
  type DatasetPreviewPayload,
  type KernelResultPayload,
  type SessionRecord,
  type TurnOutcome,
  type TurnRecord,
} from "../api.js";
import { t } from "../copy.js";

type Load<T> =
  | { phase: "loading" }
  | { phase: "error"; copyId: string }
  | { phase: "ready"; data: T };

function faultCopyId(e: unknown): string {
  return e instanceof ApiFault ? e.copyId : "error.generic.internal";
}

function tableArtifacts(turns: TurnView[]): ArtifactSummary[] {
  return turns.flatMap((turn) =>
    turn.artifacts.filter((artifact) => artifact.kind === "table_csv"),
  );
}

interface TurnView {
  id: string;
  prompt: string;
  status: string;
  operationId: string | null;
  result: KernelResultPayload | null;
  artifacts: ArtifactSummary[];
  refusal: { reason?: string; alternatives: string[] } | null;
  errorCopyId: string | null;
}

function ResultTables({ result }: { result: KernelResultPayload }) {
  return (
    <>
      {result.scalar_result && (
        <p>
          {Object.entries(result.scalar_result).map(([key, value]) => (
            <span key={key} style={{ marginRight: "1em" }}>
              <code>
                {key}={typeof value === "number" ? String(value) : JSON.stringify(value)}
              </code>
            </span>
          ))}
        </p>
      )}
      {result.tables.map((table) => (
        <div key={table.name} style={{ overflowX: "auto", marginBottom: "0.75em" }}>
          <table>
            <thead>
              <tr>
                {table.columns.map((col) => (
                  <th key={col}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j}>{cell === null ? "" : String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {table.truncated && <p className="empty">{t("session.result.truncated")}</p>}
        </div>
      ))}
      {result.plots.map((plot) => (
        <p key={plot.name}>
          <img
            src={`data:${plot.mime};base64,${plot.base64}`}
            alt={t("session.result.plot_alt", { kind: plot.name })}
            style={{ maxWidth: "100%", height: "auto" }}
          />
        </p>
      ))}
    </>
  );
}

function Turn({ turn }: { turn: TurnView }) {
  const [narration, setNarration] = useState<string | null>(null);
  const [narrating, setNarrating] = useState(false);

  const narrate = () => {
    setNarrating(true);
    setNarration("");
    streamNarration(turn.id, (chunk) => setNarration((n) => (n ?? "") + chunk))
      .catch(() => setNarration(null))
      .finally(() => setNarrating(false));
  };

  return (
    <div className="card" style={{ marginBottom: "1em" }}>
      <p>
        <strong>{turn.prompt}</strong>
      </p>
      {turn.status === "completed" && turn.operationId && (
        <p className="status-success">
          {t("session.turn.operation_label", { operation_id: turn.operationId })}
        </p>
      )}
      {turn.status === "refused" && (
        <div className="status-error">
          <p>{t("session.turn.refused_heading")}</p>
          {turn.refusal?.reason && <p>{turn.refusal.reason}</p>}
          {turn.refusal && turn.refusal.alternatives.length > 0 && (
            <p>
              {t("session.turn.alternatives", {
                alternatives: turn.refusal.alternatives.join(", "),
              })}
            </p>
          )}
        </div>
      )}
      {turn.status === "failed" && (
        <div className="status-error">
          <p>{t("session.turn.failed_heading")}</p>
          {turn.errorCopyId && <p>{t(turn.errorCopyId)}</p>}
        </div>
      )}
      {turn.result && <ResultTables result={turn.result} />}
      {turn.artifacts.length > 0 && (
        <p className="empty">
          {t("session.turn.artifacts")}{" "}
          {turn.artifacts.map((artifact) => (
            <a
              key={artifact.id}
              href={`#/artifacts/${artifact.id}`}
              style={{ marginRight: "0.5em" }}
            >
              {artifact.name}
            </a>
          ))}
        </p>
      )}
      {turn.status === "completed" && turn.result && (
        <p>
          <button className="btn-secondary" disabled={narrating} onClick={narrate}>
            {narrating ? t("session.narrating") : t("session.narrate")}
          </button>
        </p>
      )}
      {narration !== null && narration.length > 0 && <p>{narration}</p>}
    </div>
  );
}

export function Session({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Load<SessionRecord>>({ phase: "loading" });
  const [preview, setPreview] = useState<Load<DatasetPreviewPayload>>({ phase: "loading" });
  const [turns, setTurns] = useState<TurnView[]>([]);
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [inputArtifactId, setInputArtifactId] = useState<string>("");

  useEffect(() => {
    api
      .getSession(sessionId)
      .then(({ session: data, turns: rows }) => {
        setSession({ phase: "ready", data });
        if (data.file_id) {
          api
            .getPreview(data.file_id)
            .then((p) => setPreview({ phase: "ready", data: p }))
            .catch((e: unknown) => setPreview({ phase: "error", copyId: faultCopyId(e) }));
        }
        const views = rows.map(toView);
        setTurns(views);
        for (const row of rows) {
          if (row.result_r2_key) void hydrateResult(row.id);
        }
      })
      .catch((e: unknown) => setSession({ phase: "error", copyId: faultCopyId(e) }));
  }, [sessionId]);

  function toView(row: TurnRecord): TurnView {
    return {
      id: row.id,
      prompt: row.prompt,
      status: row.status,
      operationId: row.operation_id,
      result: null,
      artifacts: [],
      refusal: row.status === "refused" ? { alternatives: [] } : null,
      errorCopyId: row.status === "failed" ? "error.generic.internal" : null,
    };
  }

  function hydrateResult(turnId: string) {
    return api
      .getTurnResult(turnId)
      .then((result) =>
        setTurns((prior) =>
          prior.map((view) => (view.id === turnId ? { ...view, result } : view)),
        ),
      )
      .catch(() => undefined);
  }

  const submit = () => {
    const text = prompt.trim();
    if (text.length === 0 || running) return;
    setRunning(true);
    setBanner(null);
    api
      .postTurn(sessionId, text, inputArtifactId || undefined)
      .then((outcome: TurnOutcome) => {
        setPrompt("");
        setTurns((prior) => [
          ...prior,
          {
            id: outcome.turn_id,
            prompt: text,
            status: outcome.status ?? "failed",
            operationId: outcome.operation_id ?? null,
            result: outcome.result ?? null,
            artifacts: outcome.artifacts ?? [],
            refusal:
              outcome.status === "refused"
                ? {
                    reason: outcome.translation?.reason,
                    alternatives: outcome.translation?.supported_alternatives ?? [],
                  }
                : null,
            errorCopyId: null,
          },
        ]);
      })
      .catch((e: unknown) => setBanner(faultCopyId(e)))
      .finally(() => setRunning(false));
  };

  return (
    <section>
      {session.phase === "ready" && (
        <p>
          <a href={`#/projects/${session.data.project_id}`}>{t("session.back")}</a>
        </p>
      )}
      {session.phase === "loading" && <p className="loading">{t("projects.list.loading")}</p>}
      {session.phase === "error" && <p className="status-error">{t(session.copyId)}</p>}
      {session.phase === "ready" && (
        <>
          <h1>{session.data.title}</h1>
          <h2>{t("session.preview.heading")}</h2>
          {preview.phase === "loading" && (
            <p className="loading">{t("session.preview.loading")}</p>
          )}
          {preview.phase === "error" && (
            <p className="status-error">{t(preview.copyId)}</p>
          )}
          {preview.phase === "ready" && (
            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    {preview.data.columns.map((col) => (
                      <th key={col}>{col}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.data.rows.map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {turns.length === 0 && <p className="empty">{t("session.turns.empty")}</p>}
          {turns.map((turn) => (
            <Turn key={turn.id} turn={turn} />
          ))}

          {banner && <p className="status-error">{t(banner)}</p>}
          {tableArtifacts(turns).length > 0 && (
            <p>
              <label>
                {t("session.chain.label")}{" "}
                <select
                  className="input"
                  value={inputArtifactId}
                  onChange={(e) => setInputArtifactId(e.target.value)}
                >
                  <option value="">{t("session.chain.original")}</option>
                  {tableArtifacts(turns).map((artifact) => (
                    <option key={artifact.id} value={artifact.id}>
                      {artifact.name}
                    </option>
                  ))}
                </select>
              </label>
            </p>
          )}
          <p>
            <input
              className="input"
              style={{ width: "70%", marginRight: "0.5em" }}
              placeholder={t("session.prompt.placeholder")}
              value={prompt}
              disabled={running}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <button
              className="btn-primary"
              disabled={running || prompt.trim().length === 0}
              onClick={submit}
            >
              {running ? t("session.prompt.running") : t("session.prompt.submit")}
            </button>
          </p>
        </>
      )}
    </section>
  );
}
