import type { MiddlewareHandler } from "hono";
import { getSignedCookie, setSignedCookie } from "hono/cookie";
import type { Env } from "./env.js";

/**
 * The entire auth model (constraints.md §1): one fixed demo workspace, a
 * signed cookie identifying "the demo user". No signup, no sessions, no
 * roles. The middleware mints the cookie when absent/invalid and continues —
 * there is no 401 path.
 */
const COOKIE_NAME = "relay_demo";
const DEMO_USER = "demo-user";

export const demoUser: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const secret = c.env.RELAY_DEMO_COOKIE_SECRET;
  if (secret) {
    const existing = await getSignedCookie(c, secret, COOKIE_NAME);
    if (existing !== DEMO_USER) {
      await setSignedCookie(c, COOKIE_NAME, DEMO_USER, secret, {
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    }
  }
  await next();
};
