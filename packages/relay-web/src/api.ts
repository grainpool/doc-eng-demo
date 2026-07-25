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
};

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
