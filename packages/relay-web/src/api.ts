/** Typed fetch helpers. API errors carry {error:{code, copy_id, field?}}. */

export interface Project {
  id: string;
  name: string;
  description: string | null;
  state: "active" | "archived";
  created_at: string;
  updated_at: string;
}

export interface FileRecord {
  id: string;
  project_id: string;
  name: string;
  sha256: string;
  byte_size: number;
  mime: string;
  column_count: number | null;
  row_count: number | null;
  created_at: string;
}

export class ApiFault extends Error {
  constructor(
    public readonly copyId: string,
    public readonly code: string,
    public readonly field?: string,
  ) {
    super(code);
  }
}

async function toFault(res: Response): Promise<ApiFault> {
  try {
    const body = (await res.json()) as {
      error?: { code?: string; copy_id?: string; field?: string };
    };
    return new ApiFault(
      body.error?.copy_id ?? "error.generic.internal",
      body.error?.code ?? "INTERNAL",
      body.error?.field,
    );
  } catch {
    return new ApiFault("error.generic.internal", "INTERNAL");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiFault("error.generic.network", "NETWORK");
  }
  if (!res.ok) throw await toFault(res);
  return (await res.json()) as T;
}

export interface Conversation {
  id: string;
  owner_id: string | null;
  project_id: string | null;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StoredChatMessage {
  id: string;
  role: "user" | "assistant";
  parts: unknown[];
}

export interface ConversationDetail extends Conversation {
  messages: StoredChatMessage[];
}

export interface SessionRecord {
  id: string;
  project_id: string;
  file_id: string | null;
  title: string;
  created_at: string;
}

export interface TurnRecord {
  id: string;
  session_id: string;
  prompt: string;
  operation_id: string | null;
  params_json: string | null;
  status: string;
  error_code: string | null;
  result_r2_key: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface KernelResultPayload {
  operation_id: string;
  scalar_result: Record<string, unknown> | null;
  tables: {
    name: string;
    columns: string[];
    rows: unknown[][];
    truncated: boolean;
  }[];
  plots: {
    name: string;
    mime: string;
    base64: string;
    width: number;
    height: number;
  }[];
  duration_ms: number;
}

export interface TurnOutcome {
  turn_id: string;
  status?: string;
  operation_id?: string;
  artifacts?: ArtifactSummary[];
  result?: KernelResultPayload;
  translation?: {
    kind: string;
    reason?: string;
    supported_alternatives?: string[];
  };
  error?: { code: string; copy_id: string };
}

export interface ArtifactSummary {
  id: string;
  kind: string;
  name: string;
}

export interface ArtifactListItem {
  id: string;
  project_id: string;
  kind: string;
  name: string;
  byte_size: number;
  retention_expires_at: string | null;
  created_at: string;
}

export interface ArtifactDetail extends ArtifactListItem {
  provenance: {
    source_file_id: string;
    source_file_sha256: string;
    operation_id: string;
    params: Record<string, unknown>;
    params_hash: string;
    runtime_versions: Record<string, string>;
    kernel_image_digest: string;
    session_id: string;
    turn_id: string;
    generated_at: string;
    duration_ms: number;
    derived_from_artifact_ids: string[];
  };
}

export interface LineageNode {
  artifact: ArtifactDetail;
  derived_from: LineageNode[];
}

export interface DatasetPreviewPayload {
  columns: string[];
  rows: string[][];
  row_count: number | null;
  column_count: number | null;
}

export const api = {
  listProjects: () =>
    request<{ projects: Project[] }>("/api/projects").then((r) => r.projects),
  createProject: (name: string, description: string) =>
    request<Project>("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(description ? { name, description } : { name }),
    }),
  getProject: (id: string) => request<Project>(`/api/projects/${id}`),
  patchProject: (id: string, fields: { name?: string; description?: string | null }) =>
    request<Project>(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    }),
  archiveProject: (id: string) =>
    request<Project>(`/api/projects/${id}/archive`, { method: "POST" }),
  unarchiveProject: (id: string) =>
    request<Project>(`/api/projects/${id}/unarchive`, { method: "POST" }),
  deleteProject: (id: string) =>
    request<{ deleted: boolean; counts: Record<string, number> }>(
      `/api/projects/${id}`,
      { method: "DELETE" },
    ),
  deleteFile: (id: string) =>
    request<{ deleted: boolean }>(`/api/files/${id}`, { method: "DELETE" }),
  createConversation: (fields?: { title?: string; project_id?: string }) =>
    request<Conversation>("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields ?? {}),
    }),
  listConversations: () =>
    request<{ conversations: Conversation[] }>("/api/conversations").then(
      (r) => r.conversations,
    ),
  getConversation: (id: string) =>
    request<ConversationDetail>(`/api/conversations/${id}`),
  patchConversation: (
    id: string,
    fields: { title?: string; project_id?: string | null },
  ) =>
    request<Conversation>(`/api/conversations/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(fields),
    }),
  deleteConversation: (id: string) =>
    request<{ deleted: boolean }>(`/api/conversations/${id}`, { method: "DELETE" }),
  listFiles: (projectId: string) =>
    request<{ files: FileRecord[] }>(`/api/projects/${projectId}/files`).then(
      (r) => r.files,
    ),
  uploadFile: (projectId: string, file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<FileRecord>(`/api/projects/${projectId}/files`, {
      method: "POST",
      body: form,
    });
  },
  listSessions: (projectId: string) =>
    request<{ sessions: SessionRecord[] }>(
      `/api/projects/${projectId}/sessions`,
    ).then((r) => r.sessions),
  createSession: (projectId: string, fileId: string) =>
    request<SessionRecord>(`/api/projects/${projectId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    }),
  getSession: (id: string) =>
    request<{ session: SessionRecord; turns: TurnRecord[] }>(
      `/api/sessions/${id}`,
    ),
  postTurn: (sessionId: string, prompt: string, inputArtifactId?: string) =>
    request<TurnOutcome>(`/api/sessions/${sessionId}/turns`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        inputArtifactId ? { prompt, input_artifact_id: inputArtifactId } : { prompt },
      ),
    }),
  listArtifacts: (projectId: string) =>
    request<{ artifacts: ArtifactListItem[] }>(
      `/api/projects/${projectId}/artifacts`,
    ).then((r) => r.artifacts),
  getArtifact: (id: string) => request<ArtifactDetail>(`/api/artifacts/${id}`),
  getLineage: (id: string) => request<LineageNode>(`/api/artifacts/${id}/lineage`),
  getTurnResult: (turnId: string) =>
    request<KernelResultPayload>(`/api/turns/${turnId}/result`),
  getPreview: (fileId: string) =>
    request<DatasetPreviewPayload>(`/api/files/${fileId}/preview`),
};

/** Streams narration text chunks; calls onChunk as text arrives. */
export async function streamNarration(
  turnId: string,
  onChunk: (text: string) => void,
): Promise<void> {
  const res = await fetch(`/api/turns/${turnId}/narration`, { method: "POST" });
  if (!res.ok || !res.body) throw await toFault(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(decoder.decode(value, { stream: true }));
  }
}

let truthPromise: Promise<number> | null = null;

/** The upload limit fact, read from the product-truth API (single source). */
export function fetchUploadLimitBytes(): Promise<number> {
  truthPromise ??= request<{
    facts: { key: string; value: unknown }[];
  }>("/api/product-truth").then((snapshot) => {
    const fact = snapshot.facts.find((f) => f.key === "limit.upload.csv.max_bytes");
    return typeof fact?.value === "number" ? fact.value : 0;
  });
  return truthPromise;
}

export function humanBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    const mb = bytes / 1_048_576;
    return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
  }
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}
