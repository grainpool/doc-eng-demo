import { SELF } from "cloudflare:test";

/**
 * A browser-like fetch for tests (expansion Phase 2): carries the signed
 * relay_demo cookie across requests so a test file acts as ONE visitor, the
 * way a real browser does. Without this, every request mints a fresh
 * anonymous workspace and multi-step tests can't see their own resources.
 */
export function visitorClient(): (url: string, init?: RequestInit) => Promise<Response> {
  let cookie: string | undefined;
  return async (url, init) => {
    const headers = new Headers(init?.headers as HeadersInit | undefined);
    if (cookie && !headers.has("cookie")) headers.set("cookie", cookie);
    const res = await SELF.fetch(url, { ...init, headers });
    const pair = res.headers.get("set-cookie")?.split(";")[0];
    if (pair?.startsWith("relay_demo=")) cookie = pair;
    return res;
  };
}
