import { useEffect, useState } from "react";
import {
  api,
  ApiFault,
  type FileRecord,
  type Project,
  type SessionRecord,
} from "../api.js";
import { t } from "../copy.js";

/**
 * The Analysis entry surface (expansion Phase 3): recent sessions across
 * visible projects plus a start flow (pick project → pick dataset → session).
 * The Session screen itself is the existing implementation, rehoused.
 */
export function AnalysisEntry() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [recent, setRecent] = useState<(SessionRecord & { project_name: string })[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [files, setFiles] = useState<FileRecord[] | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [errorCopy, setErrorCopy] = useState<string | null>(null);

  useEffect(() => {
    api
      .listProjects()
      .then(async (list) => {
        setProjects(list);
        const bySession = await Promise.all(
          list.slice(0, 8).map(async (project) => {
            const sessions = await api.listSessions(project.id).catch(() => []);
            return sessions.map((s) => ({ ...s, project_name: project.name }));
          }),
        );
        setRecent(
          bySession
            .flat()
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .slice(0, 8),
        );
      })
      .catch((e: unknown) =>
        setErrorCopy(e instanceof ApiFault ? e.copyId : "error.generic.internal"),
      );
  }, []);

  useEffect(() => {
    if (!selectedProject) {
      setFiles(null);
      return;
    }
    api
      .listFiles(selectedProject)
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [selectedProject]);

  const start = (fileId: string) => {
    setStarting(fileId);
    api
      .createSession(selectedProject, fileId)
      .then((session) => {
        location.hash = `#/analysis/sessions/${session.id}`;
      })
      .catch((e: unknown) =>
        setErrorCopy(e instanceof ApiFault ? e.copyId : "error.generic.internal"),
      )
      .finally(() => setStarting(null));
  };

  return (
    <section>
      <h1>{t("nav.analysis")}</h1>
      <p>{t("analysis.entry.intro")}</p>
      {errorCopy && <p className="status-error">{t(errorCopy)}</p>}

      <h2>{t("analysis.entry.start")}</h2>
      {projects === null && <p className="loading">{t("projects.list.loading")}</p>}
      {projects !== null && projects.length === 0 && (
        <p className="empty">{t("projects.list.empty")}</p>
      )}
      {projects !== null && projects.length > 0 && (
        <div className="card" style={{ marginBottom: "1.2em" }}>
          <p>
            <select
              className="input"
              value={selectedProject}
              onChange={(e) => setSelectedProject(e.target.value)}
              aria-label={t("nav.projects")}
            >
              <option value="">{t("projects.list.title")}</option>
              {projects
                .filter((p) => p.state === "active")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </p>
          {selectedProject && files === null && (
            <p className="loading">{t("files.list.loading")}</p>
          )}
          {selectedProject && files !== null && files.length === 0 && (
            <p className="empty">
              {t("files.list.empty")}{" "}
              <a href={`#/projects/${selectedProject}`}>{t("nav.projects")}</a>
            </p>
          )}
          {selectedProject && files !== null && files.length > 0 && (
            <ul>
              {files.map((file) => (
                <li key={file.id}>
                  {file.name}{" "}
                  <button
                    className="btn-secondary"
                    disabled={starting === file.id}
                    onClick={() => start(file.id)}
                  >
                    {t("session.open")}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <h2>{t("analysis.entry.recent")}</h2>
      {recent.length === 0 && <p className="empty">{t("analysis.entry.none")}</p>}
      {recent.length > 0 && (
        <ul>
          {recent.map((session) => (
            <li key={session.id}>
              <a href={`#/analysis/sessions/${session.id}`}>{session.title}</a>{" "}
              <span className="empty">
                {session.project_name} · {new Date(session.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
