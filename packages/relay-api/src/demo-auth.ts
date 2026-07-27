import type { MiddlewareHandler } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import { newId } from "@relay/contracts";
import type { Env } from "./env.js";

/**
 * The demo identity model, v2 (expansion Phase 1, architecture.md §3 of
 * prompt-packets/relay-expansion/): the SAME signed cookie as v1, but its
 * value is now a per-browser visitor id (`vis_<ulid>`) instead of the fixed
 * string "demo-user". One workspace per browser, no signup, no roles, and
 * still no 401 path — the middleware mints an identity when the cookie is
 * absent, unsigned, or carries a legacy/foreign value, and continues.
 *
 * Routes read the identity from `c.get("visitorId")`; ownership enforcement
 * itself is workspace.ts (adopted by routes in Phase 2).
 */
const COOKIE_NAME = "relay_demo";
const VISITOR_ID_PATTERN = /^vis_[0-9abcdefghjkmnpqrstvwxyz]{26}$/;

export type DemoAuthVariables = { visitorId: string };

export const demoUser: MiddlewareHandler<{
  Bindings: Env;
  Variables: DemoAuthVariables;
}> = async (c, next) => {
  const secret = c.env.RELAY_DEMO_COOKIE_SECRET;
  let visitorId: string | null = null;

  if (secret) {
    const existing = await getSignedCookie(c, secret, COOKIE_NAME);
    if (typeof existing === "string" && VISITOR_ID_PATTERN.test(existing)) {
      visitorId = existing;
    } else {
      // Absent, tampered, or the v1 "demo-user" value: mint and set. The old
      // global-pool identity is deliberately not honored — pre-scoping rows
      // are unowned debris the Phase-2 maintenance reset removes.
      visitorId = newId("vis");
      await setSignedCookie(c, COOKIE_NAME, visitorId, secret, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  } else {
    // No signing secret (misconfigured deployment): keep the no-401 promise
    // with an ephemeral per-request identity. Nothing persists across
    // requests, which is loudly visible rather than silently global.
    visitorId = newId("vis");
  }

  c.set("visitorId", visitorId);
  await next();
};
