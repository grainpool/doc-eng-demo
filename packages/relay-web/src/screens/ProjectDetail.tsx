import { useEffect, useState } from "react";
import {
  api,
  ApiFault,
  fetchUploadLimitBytes,
  humanBytes,
  type ArtifactListItem,
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
  const [artifacts, setArtifacts] = useState<ArtifactListItem[]>([]);
  const [creatingSession, setCreatingSession] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api
      .getProject(projectId)
      .then((data) => setProject({ phase: "ready", data }))
      .catch((e: unknown) => setProject({ phase: "error", copyId: faultCopyId(e) }));
    void fetchUploadLimitBytes().then(setLimitBytes).catch(() => setLimitBytes(null));
    loadFiles();
    void api.listSessions(projectId).then(setSessions).catch(() => setSessions([]));
    void api.listArtifacts(projectId).then(setArtifacts).catch(() => setArtifacts([]));
  }, [projectId]);

  const analyze = (fileId: string) => {
    setCreatingSession(fileId);
    api
      .createSession(projectId, fileId)
      .then((session) => {
        location.hash = `#/analysis/sessions/${session.id}`;
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
  const archived = project.phase === "ready" && project.data.state === "archived";

  const applyProject = (data: Project) => setProject({ phase: "ready", data });

  const saveRename = () => {
    if (project.phase !== "ready" || renameValue.trim().length === 0) return;
    setBusy(true);
    api
      .patchProject(projectId, { name: renameValue.trim() })
      .then((data) => {
        applyProject(data);
        setRenaming(false);
      })
      .catch((e: unknown) => setBanner({ kind: "error", copyId: faultCopyId(e) }))
      .finally(() => setBusy(false));
  };

  const toggleArchive = () => {
    if (project.phase !== "ready") return;
    setBusy(true);
    (archived ? api.unarchiveProject(projectId) : api.archiveProject(projectId))
      .then(applyProject)
      .catch((e: unknown) => setBanner({ kind: "error", copyId: faultCopyId(e) }))
      .finally(() => setBusy(false));
  };

  const confirmDelete = () => {
    if (project.phase !== "ready") return;
    if (deleteTyped !== project.data.name) {
      setBanner({ kind: "error", copyId: "projects.delete.mismatch" });
      return;
    }
    setBusy(true);
    api
      .deleteProject(projectId)
      .then(() => {
        location.hash = "#/projects";
      })
      .catch((e: unknown) => {
        setBanner({ kind: "error", copyId: faultCopyId(e) });
        setBusy(false);
      });
  };

  const removeFile = (file: FileRecord) => {
    if (!window.confirm(t("files.delete.confirm", { name: file.name }))) return;
    api
      .deleteFile(file.id)
      .then(() => loadFiles())
      .catch((e: unknown) => setBanner({ kind: "error", copyId: faultCopyId(e) }));
  };

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
        <a href="#/projects">{t("projects.detail.back")}</a>
      </p>
      {project.phase === "loading" && <p className="loading">{t("projects.list.loading")}</p>}
      {project.phase === "error" && <p className="status-error">{t(project.copyId)}</p>}
      {project.phase === "ready" && (
        <>
          <h1>
            {project.data.name}{" "}
            {archived && <code>{t("projects.state.archived")}</code>}
          </h1>
          {project.data.description && <p>{project.data.description}</p>}
          <p>
            {!renaming && (
              <button
                className="btn-secondary"
                disabled={busy || archived}
                onClick={() => {
                  setRenameValue(project.data.name);
                  setRenaming(true);
                }}
              >
                {t("projects.actions.rename")}
              </button>
            )}{" "}
            <button className="btn-secondary" disabled={busy} onClick={toggleArchive}>
              {archived ? t("projects.actions.unarchive") : t("projects.actions.archive")}
            </button>{" "}
            <button
              className="btn-secondary"
              disabled={busy}
              onClick={() => setConfirmingDelete((v) => !v)}
            >
              {t("projects.actions.delete")}
            </button>
          </p>
          {renaming && (
            <p>
              <input
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                maxLength={120}
              />{" "}
              <button className="btn-primary" disabled={busy} onClick={saveRename}>
                {t("projects.actions.save")}
              </button>{" "}
              <button
                className="btn-secondary"
                disabled={busy}
                onClick={() => setRenaming(false)}
              >
                {t("projects.create.cancel")}
              </button>
            </p>
          )}
          {confirmingDelete && (
            <div className="card" style={{ marginBottom: "1em" }}>
              <p>{t("projects.delete.confirm_help")}</p>
              <p>
                <input
                  value={deleteTyped}
                  onChange={(e) => setDeleteTyped(e.target.value)}
                  placeholder={project.data.name}
                />{" "}
                <button
                  className="btn-primary"
                  disabled={busy || deleteTyped !== project.data.name}
                  onClick={confirmDelete}
                >
                  {t("projects.actions.delete")}
                </button>{" "}
                <button
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteTyped("");
                  }}
                >
                  {t("projects.create.cancel")}
                </button>
              </p>
            </div>
          )}
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
              disabled={uploading || !selected || archived}
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
                        disabled={creatingSession === file.id || archived}
                        onClick={() => analyze(file.id)}
                      >
                        {t("session.open")}
                      </button>{" "}
                      <a
                        className="btn-secondary"
                        style={{ display: "inline-block" }}
                        href={`/api/files/${file.id}/download`}
                      >
                        {t("files.actions.download")}
                      </a>{" "}
                      <button
                        className="btn-secondary"
                        disabled={archived}
                        onClick={() => removeFile(file)}
                      >
                        {t("files.actions.delete")}
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
                  <a href={`#/analysis/sessions/${session.id}`}>{session.title}</a>{" "}
                  <span className="empty">
                    {new Date(session.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2>{t("artifacts.list.heading")}</h2>
          {artifacts.length === 0 && <p className="empty">{t("artifacts.list.empty")}</p>}
          {artifacts.length > 0 && (
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
          )}
        </>
      )}
    </section>
  );
}
