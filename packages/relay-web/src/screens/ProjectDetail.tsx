import { useEffect, useState } from "react";
import {
  api,
  ApiFault,
  fetchUploadLimitBytes,
  humanBytes,
  type FileRecord,
  type Project,
  type SessionRecord,
} from "../api.js";
import { t } from "../copy.js";

type Load<T> =
  | { phase: "loading" }
  | { phase: "error"; copyId: string }
  | { phase: "ready"; data: T };

function faultCopyId(e: unknown): string {
  return e instanceof ApiFault ? e.copyId : "error.generic.internal";
}

export function ProjectDetail({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<Load<Project>>({ phase: "loading" });
  const [filesState, setFilesState] = useState<Load<FileRecord[]>>({ phase: "loading" });
  const [limitBytes, setLimitBytes] = useState<number | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [banner, setBanner] = useState<{ kind: "ok" | "error"; copyId: string } | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [creatingSession, setCreatingSession] = useState<string | null>(null);

  useEffect(() => {
    api
      .getProject(projectId)
      .then((data) => setProject({ phase: "ready", data }))
      .catch((e: unknown) => setProject({ phase: "error", copyId: faultCopyId(e) }));
    void fetchUploadLimitBytes().then(setLimitBytes).catch(() => setLimitBytes(null));
    loadFiles();
    void api.listSessions(projectId).then(setSessions).catch(() => setSessions([]));
  }, [projectId]);

  const analyze = (fileId: string) => {
    setCreatingSession(fileId);
    api
      .createSession(projectId, fileId)
      .then((session) => {
        location.hash = `#/sessions/${session.id}`;
      })
      .catch((e: unknown) => setBanner({ kind: "error", copyId: faultCopyId(e) }))
      .finally(() => setCreatingSession(null));
  };

  const loadFiles = () => {
    setFilesState({ phase: "loading" });
    api
      .listFiles(projectId)
      .then((data) => setFilesState({ phase: "ready", data }))
      .catch((e: unknown) => setFilesState({ phase: "error", copyId: faultCopyId(e) }));
  };

  const maxSizeHuman = limitBytes ? humanBytes(limitBytes) : "";

  const upload = () => {
    if (!selected) {
      setBanner({ kind: "error", copyId: "error.upload.missing_file" });
      return;
    }
    setUploading(true);
    setBanner(null);
    api
      .uploadFile(projectId, selected)
      .then(() => {
        setBanner({ kind: "ok", copyId: "uploader.success" });
        setSelected(null);
        setInputKey((k) => k + 1);
        loadFiles();
      })
      .catch((e: unknown) => setBanner({ kind: "error", copyId: faultCopyId(e) }))
      .finally(() => setUploading(false));
  };

  return (
    <section>
      <p>
        <a href="#/">{t("projects.detail.back")}</a>
      </p>
      {project.phase === "loading" && <p className="loading">{t("projects.list.loading")}</p>}
      {project.phase === "error" && <p className="status-error">{t(project.copyId)}</p>}
      {project.phase === "ready" && (
        <>
          <h1>{project.data.name}</h1>
          {project.data.description && <p>{project.data.description}</p>}
          <h2>{t("projects.detail.files_heading")}</h2>
          <div className="card" style={{ marginBottom: "1em" }}>
            <p>{t("uploader.help", { max_size_human: maxSizeHuman })}</p>
            <p>
              <label className="btn-secondary" style={{ display: "inline-block" }}>
                {t("uploader.choose")}
                <input
                  key={inputKey}
                  type="file"
                  accept=".csv,.tsv"
                  style={{ display: "none" }}
                  onChange={(e) => setSelected(e.target.files?.[0] ?? null)}
                />
              </label>{" "}
              {selected && <code>{selected.name}</code>}
            </p>
            {banner && (
              <p className={banner.kind === "ok" ? "status-success" : "status-error"}>
                {t(banner.copyId, { max_size_human: maxSizeHuman })}
              </p>
            )}
            <button
              className="btn-primary"
              disabled={uploading || !selected}
              onClick={upload}
            >
              {uploading ? t("uploader.uploading") : t("uploader.button")}
            </button>
          </div>
          {filesState.phase === "loading" && (
            <p className="loading">{t("files.list.loading")}</p>
          )}
          {filesState.phase === "error" && (
            <p className="status-error">{t(filesState.copyId)}</p>
          )}
          {filesState.phase === "ready" && filesState.data.length === 0 && (
            <p className="empty">{t("files.list.empty")}</p>
          )}
          {filesState.phase === "ready" && filesState.data.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>{t("files.table.name")}</th>
                  <th>{t("files.table.size")}</th>
                  <th>{t("files.table.rows")}</th>
                  <th>{t("files.table.columns")}</th>
                  <th>{t("files.table.uploaded")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filesState.data.map((file) => (
                  <tr key={file.id}>
                    <td>{file.name}</td>
                    <td>{humanBytes(file.byte_size)}</td>
                    <td>{file.row_count}</td>
                    <td>{file.column_count}</td>
                    <td>{new Date(file.created_at).toLocaleString()}</td>
                    <td>
                      <button
                        className="btn-secondary"
                        disabled={creatingSession === file.id}
                        onClick={() => analyze(file.id)}
                      >
                        {t("session.open")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>{t("session.list.heading")}</h2>
          {sessions.length === 0 && <p className="empty">{t("session.list.empty")}</p>}
          {sessions.length > 0 && (
            <ul>
              {sessions.map((session) => (
                <li key={session.id}>
                  <a href={`#/sessions/${session.id}`}>{session.title}</a>{" "}
                  <span className="empty">
                    {new Date(session.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
