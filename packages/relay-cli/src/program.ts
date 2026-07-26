import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";
import { Command } from "commander";
import { DEFAULT_API_URL, apiFetch, apiJson, type GlobalOpts } from "./http.js";
import { CliError, EXIT } from "./errors.js";

export const CLI_VERSION = "0.1.0";

/**
 * Examples are attached through this helper so the SAME strings feed both
 * `--help` (addHelpText) and `introspect --json` — one source, no parallel
 * hand-maintained manifest (AP9).
 */
const EXAMPLES = new WeakMap<Command, string[]>();

function withExamples(cmd: Command, ...examples: string[]): Command {
  EXAMPLES.set(cmd, examples);
  cmd.addHelpText(
    "after",
    `\nExamples:\n${examples.map((e) => `  $ ${e}`).join("\n")}\n`,
  );
  return cmd;
}

export function examplesOf(cmd: Command): string[] {
  return EXAMPLES.get(cmd) ?? [];
}

function globals(cmd: Command): GlobalOpts {
  const opts = cmd.optsWithGlobals<{
    json?: boolean;
    apiUrl?: string;
    token?: string;
    color?: boolean;
    verbose?: boolean;
  }>();
  return {
    json: opts.json,
    apiUrl: opts.apiUrl ?? DEFAULT_API_URL,
    token: opts.token,
    color: opts.color,
    verbose: opts.verbose,
  };
}

function paint(opts: GlobalOpts, code: string, text: string): string {
  if (opts.color === false || !process.stdout.isTTY) return text;
  return `[${code}m${text}[0m`;
}

function emit(opts: GlobalOpts, data: unknown, human: () => string): void {
  process.stdout.write(opts.json ? `${JSON.stringify(data, null, 2)}\n` : `${human()}\n`);
}

interface ProjectDto {
  id: string;
  name: string;
  description?: string | null;
  state: string;
  created_at: string;
}
interface FileDto {
  id: string;
  name: string;
  byte_size: number;
  row_count: number | null;
  column_count: number | null;
  sha256: string;
  created_at: string;
}
interface SessionDto {
  id: string;
  file_id: string | null;
  title: string;
  created_at: string;
}
interface ArtifactDto {
  id: string;
  kind: string;
  name: string;
  byte_size: number;
  retention_expires_at: string | null;
  created_at: string;
}

export function buildProgram(): Command {
  const program = new Command("relay");
  // Before any subcommand exists: exitOverride is copied to subcommands at
  // creation time, and the contractual exit codes depend on commander
  // throwing instead of process.exit(1) (see main()).
  program.exitOverride();
  program
    .description("Relay — bounded data analysis from your terminal.")
    .version(CLI_VERSION)
    .option("--json", "print machine-readable JSON instead of tables")
    .option("--api-url <url>", "Relay API base URL", DEFAULT_API_URL)
    .option("--token <token>", "bearer token for privileged deployments")
    .option("--no-color", "disable ANSI colors")
    .option("--verbose", "log every HTTP request to stderr");
  withExamples(
    program,
    "relay projects list",
    "relay sessions run ses_01abc \"which columns correlate?\"",
  );

  // ------------------------------------------------------------- projects
  const projects = program
    .command("projects")
    .summary("Work with projects")
    .description("List, create, and inspect Relay projects.");
  withExamples(projects, "relay projects list", "relay projects create --name \"Q3 data\"");

  withExamples(
    projects
      .command("list")
      .summary("List all projects")
      .description("List every project visible to this Relay deployment.")
      .action(async function (this: Command) {
        const opts = globals(this);
        const body = await apiJson<{ projects: ProjectDto[] }>(opts, "/api/projects");
        emit(opts, body.projects, () =>
          body.projects
            .map((p) => `${p.id}  ${paint(opts, "1", p.name)}  (${p.state})`)
            .join("\n") || "(no projects)",
        );
      }),
    "relay projects list",
    "relay projects list --json",
  );

  withExamples(
    projects
      .command("create")
      .summary("Create a project")
      .description("Create a new project.")
      .requiredOption("--name <name>", "project name")
      .option("--description <text>", "optional description")
      .action(async function (this: Command) {
        const opts = globals(this);
        const local = this.opts<{ name: string; description?: string }>();
        const project = await apiJson<ProjectDto>(opts, "/api/projects", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            local.description
              ? { name: local.name, description: local.description }
              : { name: local.name },
          ),
        });
        emit(opts, project, () => `created ${project.id}  ${project.name}`);
      }),
    'relay projects create --name "Q3 data" --description "Quarterly export"',
  );

  withExamples(
    projects
      .command("show")
      .summary("Show one project")
      .description("Show a single project by id.")
      .argument("<projectId>", "project id (prj_…)")
      .action(async function (this: Command, projectId: string) {
        const opts = globals(this);
        const project = await apiJson<ProjectDto>(opts, `/api/projects/${projectId}`);
        emit(
          opts,
          project,
          () =>
            `${project.id}\n  name: ${project.name}\n  state: ${project.state}\n  created: ${project.created_at}`,
        );
      }),
    "relay projects show prj_01abc",
  );

  // ---------------------------------------------------------------- files
  const files = program
    .command("files")
    .summary("Work with uploaded files")
    .description("List, upload, and inspect a project's data files.");
  withExamples(files, "relay files list prj_01abc", "relay files upload prj_01abc ./data.csv");

  withExamples(
    files
      .command("list")
      .summary("List a project's files")
      .description("List the files uploaded to a project.")
      .argument("<projectId>", "project id (prj_…)")
      .action(async function (this: Command, projectId: string) {
        const opts = globals(this);
        const body = await apiJson<{ files: FileDto[] }>(
          opts,
          `/api/projects/${projectId}/files`,
        );
        emit(opts, body.files, () =>
          body.files
            .map(
              (f) =>
                `${f.id}  ${f.name}  ${f.byte_size} B  ${f.row_count ?? "?"}×${f.column_count ?? "?"}`,
            )
            .join("\n") || "(no files)",
        );
      }),
    "relay files list prj_01abc",
  );

  withExamples(
    files
      .command("upload")
      .summary("Upload a CSV or TSV file")
      .description("Upload a local .csv or .tsv file to a project.")
      .argument("<projectId>", "project id (prj_…)")
      .argument("<path>", "path to a local .csv/.tsv file")
      .action(async function (this: Command, projectId: string, path: string) {
        const opts = globals(this);
        let bytes: Buffer;
        try {
          bytes = await readFile(path);
        } catch {
          throw new CliError(EXIT.VALIDATION, `cannot read file: ${path}`);
        }
        const form = new FormData();
        form.set(
          "file",
          new File([new Uint8Array(bytes)], basename(path), {
            type: path.endsWith(".tsv") ? "text/tab-separated-values" : "text/csv",
          }),
        );
        const res = await apiFetch(opts, `/api/projects/${projectId}/files`, {
          method: "POST",
          body: form,
        });
        const file = (await res.json()) as FileDto;
        emit(
          opts,
          file,
          () =>
            `uploaded ${file.id}  ${file.name}  ${file.row_count} rows × ${file.column_count} columns`,
        );
      }),
    "relay files upload prj_01abc ./sales.csv",
  );

  withExamples(
    files
      .command("show")
      .summary("Show one file")
      .description("Show a single uploaded file by id, including its sha256.")
      .argument("<fileId>", "file id (fil_…)")
      .action(async function (this: Command, fileId: string) {
        const opts = globals(this);
        const file = await apiJson<FileDto>(opts, `/api/files/${fileId}`);
        emit(
          opts,
          file,
          () =>
            `${file.id}\n  name: ${file.name}\n  size: ${file.byte_size} B\n  shape: ${file.row_count} rows × ${file.column_count} columns\n  sha256: ${file.sha256}`,
        );
      }),
    "relay files show fil_01abc",
  );

  // ------------------------------------------------------------- sessions
  const sessions = program
    .command("sessions")
    .summary("Run analysis sessions")
    .description("Create analysis sessions and ask questions in plain language.");
  withExamples(
    sessions,
    "relay sessions create prj_01abc --file fil_01abc",
    'relay sessions run ses_01abc "which columns correlate?"',
  );

  withExamples(
    sessions
      .command("list")
      .summary("List a project's sessions")
      .description("List the analysis sessions of a project.")
      .argument("<projectId>", "project id (prj_…)")
      .action(async function (this: Command, projectId: string) {
        const opts = globals(this);
        const body = await apiJson<{ sessions: SessionDto[] }>(
          opts,
          `/api/projects/${projectId}/sessions`,
        );
        emit(opts, body.sessions, () =>
          body.sessions.map((s) => `${s.id}  ${s.title}`).join("\n") || "(no sessions)",
        );
      }),
    "relay sessions list prj_01abc",
  );

  withExamples(
    sessions
      .command("create")
      .summary("Create a session bound to a file")
      .description("Create an analysis session for one project file.")
      .argument("<projectId>", "project id (prj_…)")
      .requiredOption("--file <fileId>", "file id the session analyzes")
      .option("--title <title>", "session title")
      .action(async function (this: Command, projectId: string) {
        const opts = globals(this);
        const local = this.opts<{ file: string; title?: string }>();
        const session = await apiJson<SessionDto>(
          opts,
          `/api/projects/${projectId}/sessions`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(
              local.title
                ? { file_id: local.file, title: local.title }
                : { file_id: local.file },
            ),
          },
        );
        emit(opts, session, () => `created ${session.id}  ${session.title}`);
      }),
    "relay sessions create prj_01abc --file fil_01abc",
  );

  withExamples(
    sessions
      .command("run")
      .summary("Ask a question in plain language")
      .description(
        "Send a natural-language prompt to a session. The prompt is translated to ONE bounded analysis operation (or refused); the kernel never runs model-authored code.",
      )
      .argument("<sessionId>", "session id (ses_…)")
      .argument("<prompt>", "the question, quoted")
      .option("--input-artifact <artifactId>", "run on a previous derived table instead of the file")
      .action(async function (this: Command, sessionId: string, prompt: string) {
        const opts = globals(this);
        const local = this.opts<{ inputArtifact?: string }>();
        const outcome = await apiJson<{
          status?: string;
          operation_id?: string;
          translation?: { reason?: string; supported_alternatives?: string[] };
          result?: {
            scalar_result: Record<string, unknown> | null;
            tables: { name: string; columns: string[]; rows: unknown[][] }[];
            plots: { name: string }[];
          };
          artifacts?: { id: string; kind: string; name: string }[];
        }>(opts, `/api/sessions/${sessionId}/turns`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            local.inputArtifact
              ? { prompt, input_artifact_id: local.inputArtifact }
              : { prompt },
          ),
        });
        emit(opts, outcome, () => {
          if (outcome.status === "refused") {
            const alternatives =
              outcome.translation?.supported_alternatives?.join(", ") ?? "";
            return `refused: ${outcome.translation?.reason ?? "unsupported request"}${alternatives ? `\nsupported instead: ${alternatives}` : ""}`;
          }
          const lines = [`ran ${outcome.operation_id}`];
          if (outcome.result?.scalar_result) {
            lines.push(JSON.stringify(outcome.result.scalar_result));
          }
          for (const table of outcome.result?.tables ?? []) {
            lines.push(`table ${table.name}: ${table.columns.join(", ")} (${table.rows.length} rows)`);
          }
          for (const artifact of outcome.artifacts ?? []) {
            lines.push(`artifact ${artifact.id} (${artifact.kind}) ${artifact.name}`);
          }
          return lines.join("\n");
        });
      }),
    'relay sessions run ses_01abc "which columns correlate?"',
    'relay sessions run ses_01abc "correlate these" --input-artifact art_01abc',
  );

  // ------------------------------------------------------------ artifacts
  const artifacts = program
    .command("artifacts")
    .summary("Inspect and download artifacts")
    .description("Every analysis output is a durable artifact with full provenance.");
  withExamples(artifacts, "relay artifacts list prj_01abc", "relay artifacts download art_01abc");

  withExamples(
    artifacts
      .command("list")
      .summary("List a project's artifacts")
      .description("List the artifacts of a project.")
      .argument("<projectId>", "project id (prj_…)")
      .action(async function (this: Command, projectId: string) {
        const opts = globals(this);
        const body = await apiJson<{ artifacts: ArtifactDto[] }>(
          opts,
          `/api/projects/${projectId}/artifacts`,
        );
        emit(opts, body.artifacts, () =>
          body.artifacts
            .map((a) => `${a.id}  ${a.kind}  ${a.name}  ${a.byte_size} B`)
            .join("\n") || "(no artifacts)",
        );
      }),
    "relay artifacts list prj_01abc",
  );

  withExamples(
    artifacts
      .command("show")
      .summary("Show an artifact with its provenance")
      .description(
        "Show one artifact: source file, operation, params, runtime versions, timing, lineage.",
      )
      .argument("<artifactId>", "artifact id (art_…)")
      .action(async function (this: Command, artifactId: string) {
        const opts = globals(this);
        const artifact = await apiJson<{
          id: string;
          kind: string;
          name: string;
          retention_expires_at: string | null;
          provenance: Record<string, unknown>;
        }>(opts, `/api/artifacts/${artifactId}`);
        emit(
          opts,
          artifact,
          () =>
            `${artifact.id}  ${artifact.kind}  ${artifact.name}\n  retained until: ${artifact.retention_expires_at ?? "no expiry"}\n  provenance: ${JSON.stringify(artifact.provenance, null, 2)}`,
        );
      }),
    "relay artifacts show art_01abc",
  );

  withExamples(
    artifacts
      .command("download")
      .summary("Download an artifact")
      .description("Download an artifact's bytes to a local file.")
      .argument("<artifactId>", "artifact id (art_…)")
      .option("--out <path>", "output path (defaults to the artifact filename)")
      .action(async function (this: Command, artifactId: string) {
        const opts = globals(this);
        const local = this.opts<{ out?: string }>();
        const res = await apiFetch(opts, `/api/artifacts/${artifactId}/download`);
        const disposition = res.headers.get("content-disposition") ?? "";
        const suggested =
          /filename="([^"]+)"/.exec(disposition)?.[1] ?? `${artifactId}.bin`;
        const out = local.out ?? suggested;
        await writeFile(out, Buffer.from(await res.arrayBuffer()));
        emit(opts, { saved: out }, () => `saved ${out}`);
      }),
    "relay artifacts download art_01abc --out ./correlation.csv",
  );

  // --------------------------------------------------------------- config
  const config = program
    .command("config")
    .summary("Inspect CLI configuration and API health")
    .description("Show the resolved CLI configuration and check the Relay API.");
  withExamples(config, "relay config show", "relay config status");

  withExamples(
    config
      .command("show")
      .summary("Show resolved configuration")
      .description("Show the API URL and whether a token is set (never the token itself).")
      .action(function (this: Command) {
        const opts = globals(this);
        const data = {
          api_url: opts.apiUrl,
          token_set: Boolean(opts.token),
          color: opts.color !== false,
        };
        emit(
          opts,
          data,
          () =>
            `api_url: ${data.api_url}\ntoken: ${data.token_set ? "set" : "not set"}\ncolor: ${data.color}`,
        );
      }),
    "relay config show",
  );

  withExamples(
    config
      .command("status")
      .summary("Check the Relay API health")
      .description("Call GET /api/health and summarize the five checks.")
      .action(async function (this: Command) {
        const opts = globals(this);
        const health = await apiJson<{
          all_ok: boolean;
          checks: Record<string, { ok: boolean; duration_ms: number }>;
        }>(opts, "/api/health");
        emit(opts, health, () =>
          [
            health.all_ok ? paint(opts, "32", "all checks ok") : paint(opts, "31", "NOT ok"),
            ...Object.entries(health.checks).map(
              ([name, check]) =>
                `  ${check.ok ? "ok " : "FAIL"} ${name} (${check.duration_ms} ms)`,
            ),
          ].join("\n"),
        );
      }),
    "relay config status",
  );

  // ------------------------------------------------------------ introspect
  withExamples(
    program
      .command("introspect")
      .summary("Emit the machine-readable CLI surface")
      .description(
        "Walk the live command tree and emit every command's path, summary, usage, flags, exit codes, and examples. This output is the T2_CLI authority source; it is derived, never authored.",
      )
      .option("--json", "emit JSON (the only supported format)")
      .action(async function (this: Command) {
        // Imported lazily to avoid a cycle (introspect walks this program).
        const { introspect } = await import("./introspect.js");
        process.stdout.write(
          `${JSON.stringify(introspect(this.parent as Command), null, 2)}\n`,
        );
      }),
    "relay introspect --json",
  );

  return program;
}
