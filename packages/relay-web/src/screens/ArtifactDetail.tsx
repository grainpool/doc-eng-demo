import { useEffect, useState } from "react";
import {
  api,
  ApiFault,
  humanBytes,
  type ArtifactDetail as Detail,
  type LineageNode,
} from "../api.js";
import { t } from "../copy.js";

type Load<T> =
  | { phase: "loading" }
  | { phase: "error"; copyId: string }
  | { phase: "ready"; data: T };

function faultCopyId(e: unknown): string {
  return e instanceof ApiFault ? e.copyId : "error.generic.internal";
}

function Lineage({ node }: { node: LineageNode }) {
  return (
    <ul>
      <li>
        <a href={`#/artifacts/${node.artifact.id}`}>
          {node.artifact.name} ({node.artifact.kind})
        </a>{" "}
        — {node.artifact.provenance.operation_id}
        {node.derived_from.map((parent) => (
          <Lineage key={parent.artifact.id} node={parent} />
        ))}
      </li>
    </ul>
  );
}

const RETENTION_DAY_MS = 86_400_000;

export function ArtifactDetail({ artifactId }: { artifactId: string }) {
  const [state, setState] = useState<Load<Detail>>({ phase: "loading" });
  const [lineage, setLineage] = useState<LineageNode | null>(null);

  useEffect(() => {
    setState({ phase: "loading" });
    api
      .getArtifact(artifactId)
      .then((data) => {
        setState({ phase: "ready", data });
        return api.getLineage(artifactId).then(setLineage);
      })
      .catch((e: unknown) => setState({ phase: "error", copyId: faultCopyId(e) }));
  }, [artifactId]);

  if (state.phase === "loading") {
    return <p className="loading">{t("projects.list.loading")}</p>;
  }
  if (state.phase === "error") {
    return <p className="status-error">{t(state.copyId)}</p>;
  }
  const artifact = state.data;
  const prov = artifact.provenance;
  const retentionDays = artifact.retention_expires_at
    ? Math.round(
        (new Date(artifact.retention_expires_at).getTime() -
          new Date(prov.generated_at).getTime()) /
          RETENTION_DAY_MS,
      )
    : null;

  return (
    <section>
      <p>
        <a href={`#/projects/${artifact.project_id}`}>{t("artifact.back")}</a>
      </p>
      <h1>
        {artifact.name} <code>{artifact.kind}</code>
      </h1>
      <p>
        <a className="btn-secondary" href={`/api/artifacts/${artifact.id}/download`}>
          {t("artifact.download")}
        </a>{" "}
        <span className="empty">{humanBytes(artifact.byte_size)}</span>
      </p>
      {artifact.retention_expires_at && retentionDays !== null && (
        <p className="empty">
          {t("artifact.retention", {
            expires_at: new Date(artifact.retention_expires_at).toLocaleDateString(),
            days: retentionDays,
          })}
        </p>
      )}

      <h2>{t("artifact.provenance.heading")}</h2>
      <div className="card">
        <p>
          <strong>{t("artifact.provenance.source_file")}</strong>:{" "}
          <code>{prov.source_file_id}</code>{" "}
          <code>{prov.source_file_sha256.slice(0, 16)}…</code>
        </p>
        <p>
          <strong>{t("artifact.provenance.operation")}</strong>:{" "}
          <code>{prov.operation_id}</code>
        </p>
        <p>
          <strong>{t("artifact.provenance.params")}</strong>:{" "}
          <code>{JSON.stringify(prov.params)}</code>
        </p>
        <p>
          <strong>{t("artifact.provenance.versions")}</strong>:{" "}
          {Object.entries(prov.runtime_versions)
            .filter(([name]) => name !== "image_digest")
            .map(([name, version]) => (
              <code key={name} style={{ marginRight: "0.5em" }}>
                {name} {version}
              </code>
            ))}
        </p>
        <p className="empty">
          {t("artifact.provenance.generated", {
            generated_at: new Date(prov.generated_at).toLocaleString(),
            duration_ms: prov.duration_ms,
          })}
        </p>
      </div>

      <h2>{t("artifact.lineage.heading")}</h2>
      {lineage && lineage.derived_from.length === 0 && (
        <p className="empty">{t("artifact.lineage.none")}</p>
      )}
      {lineage && lineage.derived_from.length > 0 && <Lineage node={lineage} />}
    </section>
  );
}
