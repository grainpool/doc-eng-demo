import { CliError, EXIT, exitCodeForStatus } from "./errors.js";

export interface GlobalOpts {
  json?: boolean;
  apiUrl: string;
  token?: string;
  color?: boolean; // commander sets color:false for --no-color
  verbose?: boolean;
}

export const DEFAULT_API_URL = "https://relay.otonieltrejo.com";

function headers(opts: GlobalOpts): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.token) out.authorization = `Bearer ${opts.token}`;
  return out;
}

async function toCliError(res: Response): Promise<CliError> {
  let detail = "";
  try {
    const body = (await res.json()) as {
      error?: { code?: string; copy_id?: string; detail?: string };
    };
    detail = body.error?.detail ?? body.error?.code ?? "";
  } catch {
    /* non-JSON error body */
  }
  return new CliError(
    exitCodeForStatus(res.status),
    `API error ${res.status}${detail ? `: ${detail}` : ""}`,
  );
}

export async function apiFetch(
  opts: GlobalOpts,
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const url = `${opts.apiUrl.replace(/\/$/, "")}${path}`;
  if (opts.verbose) {
    process.stderr.write(`> ${init?.method ?? "GET"} ${url}\n`);
  }
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: { ...headers(opts), ...(init?.headers as Record<string, string>) },
    });
  } catch (e) {
    throw new CliError(
      EXIT.REMOTE_UNAVAILABLE,
      `could not reach ${url}: ${e instanceof Error ? e.message : "network error"}`,
    );
  }
  if (!res.ok) throw await toCliError(res);
  return res;
}

export async function apiJson<T>(
  opts: GlobalOpts,
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(opts, path, init);
  return (await res.json()) as T;
}
