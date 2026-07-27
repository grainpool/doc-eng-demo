import { useEffect, useState } from "react";
import { api, type ArtifactListItem, type Project } from "../api.js";
import { t } from "../copy.js";

/**
 * Artifacts as a first-class area (Phase 3 interim): grouped by visible
 * project using the existing per-project endpoints. Phase 6 replaces the
 * N-fetch grouping with the global scoped route + filters.
 */
export function ArtifactsBrowse() {
  const [groups, setGroups] = useState<
    { project: Project; artifacts: ArtifactListItem[] }[] | null
  >(null);

  useEffect(() => {
    api
      .listProjects()
      .then(async (projects) => {
        const withArtifacts = await Promise.all(
          projects.map(async (project) => ({
            project,
            artifacts: await api.listArtifacts(project.id).catch(() => []),
          })),
        );
        setGroups(withArtifacts.filter((g) => g.artifacts.length > 0));
      })
      .catch(() => setGroups([]));
  }, []);

  return (
    <section>
      <h1>{t("nav.artifacts")}</h1>
      <p>{t("artifacts.browse.intro")}</p>
      {groups === null && <p className="loading">{t("projects.list.loading")}</p>}
      {groups !== null && groups.length === 0 && (
        <p className="empty">{t("artifacts.browse.empty")}</p>
      )}
      {groups !== null &&
        groups.map(({ project, artifacts }) => (
          <div key={project.id}>
            <h2>
              <a href={`#/projects/${project.id}`}>{project.name}</a>
            </h2>
            <ul>
              {artifacts.map((artifact) => (
                <li key={artifact.id}>
                  <a href={`#/artifacts/${artifact.id}`}>{artifact.name}</a>{" "}
                  <code>{artifact.kind}</code>{" "}
                  <span className="empty">
                    {new Date(artifact.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}
