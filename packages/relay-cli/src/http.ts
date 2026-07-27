import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { CliError, EXIT, exitCodeForStatus } from "./errors.js";

export interface GlobalOpts {
  json?: boolean;
  apiUrl: string;
  token?: string;
  color?: boolean; // commander sets color:false for --no-color
  verbose?: boolean;
}

export const DEFAULT_API_URL = "https://relay.otonieltrejo.com";

/**
 * Demo-workspace identity (expansion Phase 2, architecture.md §3): the API
 * scopes resources to the signed `relay_demo` cookie. The CLI persists the
 * cookie the server mints so every invocation lands in ONE workspace instead
 * of minting a fresh anonymous identity per request. Value is the signed
 * cookie pair, useless without the server's signing secret — but stored 0600
 * anyway, like any credential-shaped file.
 */
const SESSION_FILE = join(homedir(), ".config", "relay", "session");

let sessionCookie: string | null | undefined; // undefined = not loaded yet

export function loadSessionCookie(): string | null {
  if (sessionCookie === undefined) {
    try {
      const raw = readFileSync(SESSION_FILE, "utf8").trim();
      sessionCookie = /^relay_demo=[^;\s]+$/.test(raw) ? raw : null;
    } catch {
      sessionCookie = null;
    }
  }
  return sessionCookie;
}

export function hasSavedIdentity(): boolean {
  return loadSessionCookie() !== null;
}

function persistSessionCookie(setCookies: string[]): void {
  for (const header of setCookies) {
    const pair = header.split(";")[0]?.trim();
    if (pair?.startsWith("relay_demo=")) {
      try {
        mkdirSync(dirname(SESSION_FILE), { recursive: true, mode: 0o700 });
        writeFileSync(SESSION_FILE, `${pair}\n`, { mode: 0o600 });
        sessionCookie = pair;
      } catch {
        // Persisting identity is best-effort; the request already succeeded.
      }
      return;
    }
  }
}

function headers(opts: GlobalOpts): Record<string, string> {
  const out: Record<string, string> = {};
  if (opts.token) out.authorization = `Bearer ${opts.token}`;
  const cookie = loadSessionCookie();
  if (cookie) out.cookie = cookie;
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
  persistSessionCookie(res.headers.getSetCookie());
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
