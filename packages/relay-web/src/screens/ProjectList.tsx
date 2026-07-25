import { useEffect, useState, type FormEvent } from "react";
import { api, ApiFault, type Project } from "../api.js";
import { t } from "../copy.js";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; copyId: string }
  | { phase: "ready"; projects: Project[] };

export function ProjectList() {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setState({ phase: "loading" });
    api
      .listProjects()
      .then((projects) => setState({ phase: "ready", projects }))
      .catch((e: unknown) =>
        setState({
          phase: "error",
          copyId: e instanceof ApiFault ? e.copyId : "error.generic.internal",
        }),
      );
  };
  useEffect(load, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    api
      .createProject(name.trim(), description.trim())
      .then((project) => {
        setCreating(false);
        setName("");
        setDescription("");
        location.hash = `#/projects/${project.id}`;
      })
      .catch((e: unknown) =>
        setFormError(e instanceof ApiFault ? e.copyId : "error.generic.internal"),
      )
      .finally(() => setBusy(false));
  };

  return (
    <section>
      <h1>{t("projects.list.title")}</h1>
      {!creating && (
        <p>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            {t("projects.create.open")}
          </button>
        </p>
      )}
      {creating && (
        <form className="card" onSubmit={submit} style={{ marginBottom: "1em" }}>
          <p>
            <label>
              {t("projects.create.name_label")}
              <br />
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={120}
              />
            </label>
          </p>
          <p>
            <label>
              {t("projects.create.description_label")}
              <br />
              <input
                className="input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={2000}
                style={{ width: "100%" }}
              />
            </label>
          </p>
          {formError && <p className="status-error">{t(formError)}</p>}
          <button className="btn-primary" type="submit" disabled={busy || !name.trim()}>
            {t("projects.create.submit")}
          </button>{" "}
          <button
            className="btn-secondary"
            type="button"
            onClick={() => setCreating(false)}
          >
            {t("projects.create.cancel")}
          </button>
        </form>
      )}
      {state.phase === "loading" && <p className="loading">{t("projects.list.loading")}</p>}
      {state.phase === "error" && <p className="status-error">{t(state.copyId)}</p>}
      {state.phase === "ready" && state.projects.length === 0 && (
        <p className="empty">{t("projects.list.empty")}</p>
      )}
      {state.phase === "ready" &&
        state.projects.map((project) => (
          <div className="card" key={project.id} style={{ marginBottom: "0.7em" }}>
            <p style={{ margin: 0 }}>
              <a href={`#/projects/${project.id}`}>{project.name}</a>{" "}
              <span style={{ float: "right" }}>
                {t(
                  project.state === "active"
                    ? "projects.state.active"
                    : "projects.state.archived",
                )}
              </span>
            </p>
            {project.description && (
              <p style={{ margin: "0.4em 0 0 0" }}>{project.description}</p>
            )}
          </div>
        ))}
    </section>
  );
}
