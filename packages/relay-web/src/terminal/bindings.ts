import { api, humanBytes } from "../api.js";
import { t } from "../copy.js";

/**
 * Bindings: the explicit map from SUPPORTED fixture command paths to the
 * existing web API client (same cookie, same workspace, same scoping as the
 * rest of the UI — no privileged path). The parity test asserts every key
 * here exists in the fixture and uses only fixture-declared flags; commands
 * absent from this map but present in the fixture render the installed-CLI
 * pointer instead of a second implementation.
 */

export interface Binding {
  /** Human argument names for the usage hint; arity is enforced. */
  positionals: string[];
  /** Flags this binding actually reads — must be ⊆ the fixture's flags. */
  flags: string[];
  run(
    positionals: string[],
    flags: Record<string, string | boolean>,
  ): Promise<string[]>;
}

function needsYes(flags: Record<string, string | boolean>): string[] | null {
  return flags["--yes"] === true ? null : [t("terminal.confirm_yes")];
}

export const BINDINGS: Record<string, Binding> = {
  "projects list": {
    positionals: [],
    flags: [],
    run: async () => {
      const projects = await api.listProjects();
      if (projects.length === 0) return [t("projects.list.empty")];
      return projects.map((p) => `${p.id}  ${p.name}  (${p.state})`);
    },
  },
  "projects show": {
    positionals: ["projectId"],
    flags: [],
    run: async ([id]) => {
      const p = await api.getProject(id as string);
      return [
        p.id,
        `  name: ${p.name}`,
        ...(p.description ? [`  description: ${p.description}`] : []),
        `  state: ${p.state}`,
        `  created: ${p.created_at}`,
      ];
    },
  },
  "projects create": {
    positionals: [],
    flags: ["--name", "--description"],
    run: async (_p, flags) => {
      const name = flags["--name"];
      if (typeof name !== "string") return [t("error.validation.required_field")];
      const description = flags["--description"];
      const project = await api.createProject(
        name,
        typeof description === "string" ? description : "",
      );
      return [`${project.id}  ${project.name}`];
    },
  },
  "projects rename": {
    positionals: ["projectId"],
    flags: ["--name", "--description"],
    run: async ([id], flags) => {
      const fields: { name?: string; description?: string } = {};
      if (typeof flags["--name"] === "string") fields.name = flags["--name"];
      if (typeof flags["--description"] === "string")
        fields.description = flags["--description"];
      if (!fields.name && fields.description === undefined)
        return [t("error.validation.required_field")];
      const project = await api.patchProject(id as string, fields);
      return [`${project.id}  ${project.name}`];
    },
  },
  "projects archive": {
    positionals: ["projectId"],
    flags: [],
    run: async ([id]) => {
      const project = await api.archiveProject(id as string);
      return [`${project.id}  ${project.name}  (${project.state})`];
    },
  },
  "projects unarchive": {
    positionals: ["projectId"],
    flags: [],
    run: async ([id]) => {
      const project = await api.unarchiveProject(id as string);
      return [`${project.id}  ${project.name}  (${project.state})`];
    },
  },
  "projects delete": {
    positionals: ["projectId"],
    flags: ["--yes"],
    run: async ([id], flags) => {
      const confirm = needsYes(flags);
      if (confirm) return confirm;
      const result = await api.deleteProject(id as string);
      return [
        Object.entries(result.counts)
          .map(([k, v]) => `${k}: ${v}`)
          .join("  "),
      ];
    },
  },
  "files list": {
    positionals: ["projectId"],
    flags: [],
    run: async ([projectId]) => {
      const files = await api.listFiles(projectId as string);
      if (files.length === 0) return [t("files.list.empty")];
      return files.map(
        (f) =>
          `${f.id}  ${f.name}  ${humanBytes(f.byte_size)}  ${f.row_count ?? "?"}×${f.column_count ?? "?"}`,
      );
    },
  },
  "files show": {
    positionals: ["fileId"],
    flags: [],
    run: async ([id]) => {
      const files = await fileById(id as string);
      return files;
    },
  },
  "files download": {
    positionals: ["fileId"],
    flags: ["--out"],
    run: ([id]) => {
      window.location.assign(`/api/files/${id}/download`);
      return Promise.resolve([t("terminal.download_started")]);
    },
  },
  "files delete": {
    positionals: ["fileId"],
    flags: ["--yes"],
    run: async ([id], flags) => {
      const confirm = needsYes(flags);
      if (confirm) return confirm;
      await api.deleteFile(id as string);
      return [`${id}`];
    },
  },
  "sessions list": {
    positionals: ["projectId"],
    flags: [],
    run: async ([projectId]) => {
      const sessions = await api.listSessions(projectId as string);
      if (sessions.length === 0) return [t("session.list.empty")];
      return sessions.map((s) => `${s.id}  ${s.title}`);
    },
  },
  "sessions create": {
    positionals: ["projectId"],
    flags: ["--file", "--title"],
    run: async ([projectId], flags) => {
      const fileId = flags["--file"];
      if (typeof fileId !== "string") return [t("error.validation.required_field")];
      const session = await api.createSession(projectId as string, fileId);
      return [`${session.id}  ${session.title}`];
    },
  },
  "sessions run": {
    positionals: ["sessionId", "prompt"],
    flags: ["--input-artifact"],
    run: async ([sessionId, prompt], flags) => {
      const inputArtifact = flags["--input-artifact"];
      const outcome = await api.postTurn(
        sessionId as string,
        prompt as string,
        typeof inputArtifact === "string" ? inputArtifact : undefined,
      );
      if (outcome.status === "refused") {
        const alternatives = outcome.translation?.supported_alternatives ?? [];
        return [
          `${t("session.turn.refused_heading")} ${outcome.translation?.reason ?? ""}`,
          ...(alternatives.length > 0
            ? [`${t("session.turn.alternatives")} ${alternatives.join(", ")}`]
            : []),
        ];
      }
      if (outcome.error) return [t(outcome.error.copy_id)];
      const lines = [`${outcome.operation_id ?? ""}`];
      if (outcome.result?.scalar_result) {
        lines.push(JSON.stringify(outcome.result.scalar_result));
      }
      for (const table of outcome.result?.tables ?? []) {
        lines.push(`${table.name}: ${table.columns.join(", ")} (${table.rows.length})`);
      }
      for (const artifact of outcome.artifacts ?? []) {
        lines.push(`${artifact.id}  ${artifact.kind}  ${artifact.name}`);
      }
      return lines.filter(Boolean);
    },
  },
  "artifacts list": {
    positionals: ["projectId"],
    flags: [],
    run: async ([projectId]) => {
      const artifacts = await api.listArtifacts(projectId as string);
      if (artifacts.length === 0) return [t("artifacts.list.empty")];
      return artifacts.map(
        (a) => `${a.id}  ${a.kind}  ${a.name}  ${humanBytes(a.byte_size)}`,
      );
    },
  },
  "artifacts show": {
    positionals: ["artifactId"],
    flags: [],
    run: async ([id]) => {
      const artifact = await api.getArtifact(id as string);
      return [
        `${artifact.id}  ${artifact.kind}  ${artifact.name}`,
        `  ${t("artifact.provenance.operation")} ${artifact.provenance.operation_id}`,
        `  ${t("artifact.provenance.source_file")} ${artifact.provenance.source_file_id}`,
        `  ${t("artifact.provenance.generated")} ${artifact.provenance.generated_at}`,
      ];
    },
  },
  "artifacts delete": {
    positionals: ["artifactId"],
    flags: ["--yes"],
    run: async ([id], flags) => {
      const confirm = needsYes(flags);
      if (confirm) return confirm;
      await api.deleteArtifact(id as string);
      return [`${id}`];
    },
  },
  "artifacts download": {
    positionals: ["artifactId"],
    flags: ["--out"],
    run: ([id]) => {
      window.location.assign(`/api/artifacts/${id}/download`);
      return Promise.resolve([t("terminal.download_started")]);
    },
  },
  "config show": {
    positionals: [],
    flags: [],
    run: () =>
      Promise.resolve([
        `api_url: ${window.location.origin}`,
        `workspace: ${t("workspace.banner.label")}`,
      ]),
  },
  "config status": {
    positionals: [],
    flags: [],
    run: async () => {
      const res = await fetch("/api/health");
      const health = (await res.json()) as {
        all_ok: boolean;
        checks: Record<string, { ok: boolean; duration_ms: number }>;
      };
      return [
        health.all_ok ? t("health.all_ok") : t("health.not_ok"),
        ...Object.entries(health.checks).map(
          ([name, check]) => `  ${check.ok ? "ok  " : "FAIL"} ${name} (${check.duration_ms} ms)`,
        ),
      ];
    },
  },
  introspect: {
    positionals: [],
    flags: ["--json"],
    run: async () => {
      const { allCommands } = await import("./grammar.js");
      return allCommands().map((c) => `${c.path}  —  ${c.summary}`);
    },
  },
};

async function fileById(id: string): Promise<string[]> {
  const res = await fetch(`/api/files/${id}`);
  if (!res.ok) return [t("error.generic.not_found")];
  const f = (await res.json()) as {
    id: string;
    name: string;
    byte_size: number;
    row_count: number | null;
    column_count: number | null;
    sha256: string;
  };
  return [
    f.id,
    `  name: ${f.name}`,
    `  size: ${humanBytes(f.byte_size)}`,
    `  shape: ${f.row_count ?? "?"} × ${f.column_count ?? "?"}`,
    `  sha256: ${f.sha256}`,
  ];
}
