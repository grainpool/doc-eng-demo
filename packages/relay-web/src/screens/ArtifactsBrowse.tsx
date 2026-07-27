import { useEffect, useState } from "react";
import { api, type ArtifactListItem, type Project } from "../api.js";
import { t } from "../copy.js";

const KINDS = ["plot", "table_csv", "summary_json", "operation_record"];

/**
 * Artifacts as a first-class area (Phase 6): the global scoped route with
 * project and kind filters — no more per-project N-fetch grouping.
 */
export function ArtifactsBrowse() {
  const [artifacts, setArtifacts] = useState<
    (ArtifactListItem & { project_name: string })[] | null
  >(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectFilter, setProjectFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    setArtifacts(null);
    api
      .browseArtifacts({
        ...(projectFilter ? { project_id: projectFilter } : {}),
        ...(kindFilter ? { kind: kindFilter } : {}),
      })
      .then(setArtifacts)
      .catch(() => setArtifacts([]));
  }, [projectFilter, kindFilter]);

  return (
    <section>
      <h1>{t("nav.artifacts")}</h1>
      <p>{t("artifacts.browse.intro")}</p>
      <p>
        <select
          className="input"
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          aria-label={t("nav.projects")}
        >
          <option value="">{t("artifacts.filter.all_projects")}</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>{" "}
        <select
          className="input"
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          aria-label={t("artifacts.filter.kind")}
        >
          <option value="">{t("artifacts.filter.all_kinds")}</option>
          {KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </p>
      {artifacts === null && <p className="loading">{t("chat.loading")}</p>}
      {artifacts !== null && artifacts.length === 0 && (
        <p className="empty">{t("artifacts.browse.empty")}</p>
      )}
      {artifacts !== null && artifacts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>{t("files.table.name")}</th>
              <th>{t("artifacts.filter.kind")}</th>
              <th>{t("nav.projects")}</th>
              <th>{t("files.table.uploaded")}</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.map((artifact) => (
              <tr key={artifact.id}>
                <td>
                  <a href={`#/artifacts/${artifact.id}`}>{artifact.name}</a>
                </td>
                <td>
                  <code>{artifact.kind}</code>
                </td>
                <td>
                  <a href={`#/projects/${artifact.project_id}`}>
                    {artifact.project_name}
                  </a>
                </td>
                <td>{new Date(artifact.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
