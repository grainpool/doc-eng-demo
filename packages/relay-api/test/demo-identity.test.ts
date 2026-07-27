// Expansion Phase 1 acceptance (expansion validation.md §2 groundwork): the
// demo cookie now carries a per-browser visitor id. Asserts minting, cookie
// round-trip stability, isolation between two fresh "browsers", legacy-value
// re-minting, and the workspace scoping matrix routes adopt in Phase 2.
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { canMutate, canRead, SEED_OWNER } from "../src/workspace.js";

const VISITOR_ID = /^vis_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

async function whoami(cookie?: string) {
  const res = await SELF.fetch("https://example.com/api/whoami", {
    headers: cookie ? { cookie } : {},
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { visitor_id: string };
  return { body, setCookie: res.headers.get("set-cookie") };
}

/** The relay_demo pair from a set-cookie header, for replay as a request cookie. */
function demoCookieOf(setCookie: string | null): string {
  expect(setCookie).not.toBeNull();
  const pair = (setCookie as string).split(";")[0];
  expect(pair).toMatch(/^relay_demo=/);
  return pair as string;
}

describe("GET /api/whoami — per-visitor demo identity", () => {
  it("mints a vis_* id and sets the signed cookie on first contact", async () => {
    const { body, setCookie } = await whoami();
    expect(body.visitor_id).toMatch(VISITOR_ID);
    const cookie = demoCookieOf(setCookie);
    expect(cookie).toContain(encodeURIComponent(body.visitor_id).slice(0, 10));
  });

  it("returns the SAME id when the cookie is replayed, without re-setting it", async () => {
    const first = await whoami();
    const cookie = demoCookieOf(first.setCookie);
    const second = await whoami(cookie);
    expect(second.body.visitor_id).toBe(first.body.visitor_id);
    expect(second.setCookie).toBeNull();
  });

  it("gives two fresh browsers two different identities", async () => {
    const a = await whoami();
    const b = await whoami();
    expect(a.body.visitor_id).not.toBe(b.body.visitor_id);
  });

  it("re-mints on an unsigned/tampered cookie value (covers the legacy demo-user shape)", async () => {
    const { body, setCookie } = await whoami("relay_demo=demo-user");
    expect(body.visitor_id).toMatch(VISITOR_ID);
    expect(setCookie).not.toBeNull();
  });
});

describe("workspace scoping rule (adopted by routes in Phase 2)", () => {
  const me = "vis_0000000000000000000000test";
  const other = "vis_0000000000000000000other0";

  it("read: mine and seed only", () => {
    expect(canRead(me, me)).toBe(true);
    expect(canRead(SEED_OWNER, me)).toBe(true);
    expect(canRead(other, me)).toBe(false);
    expect(canRead(null, me)).toBe(false); // NULL owners have no API semantics
  });

  it("mutate: mine ok, seed is the one honest 403, everything else 404s", () => {
    expect(canMutate(me, me)).toBe("ok");
    expect(canMutate(SEED_OWNER, me)).toBe("seed_read_only");
    expect(canMutate(other, me)).toBe("not_found"); // never confirm existence
    expect(canMutate(null, me)).toBe("not_found");
  });
});
