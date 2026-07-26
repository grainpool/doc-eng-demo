import { createRemoteJWKSet, jwtVerify, importJWK, type JWTVerifyGetKey } from "jose";
import type { Context, Next } from "hono";

/**
 * Cloudflare Access identity gate (security.md §2, Phase 18).
 *
 * Non-negotiable properties, verified by test/access.test.ts:
 *  - DEMO_ADMIN_ENABLED !== "true" → 404: default-off, so a misconfigured
 *    Access application cannot expose a live mutation path (invariant I12).
 *  - A missing Cf-Access-Jwt-Assertion header is a 403, NEVER a bypass.
 *    There is no "if not in production, skip" branch in this file, and the
 *    production sources import no dev middleware (grep-asserted).
 *  - jwtVerify checks signature AND `iss` AND `aud` AND expiry. Signature-
 *    only verification would accept any Access team's token.
 *  - The @anthropic.com domain check is repeated in code even though the
 *    Access policy enforces it. Two independent gates (AP10).
 *  - The identity lands on the context for audit_log; the public view
 *    redacts to the domain.
 *
 * Key source: the remote JWKS at
 * https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs. Tests inject a local
 * public JWK via the TEST_ACCESS_JWKS binding — verification itself (iss,
 * aud, exp, domain) is identical; only where the public key comes from
 * differs, and the deployed configuration never sets that binding.
 */

export interface AccessEnv {
  DEMO_ADMIN_ENABLED?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Test-only: a JSON JWK public key. Never set in deployed config. */
  TEST_ACCESS_JWKS?: string;
}

export interface AccessIdentity {
  email: string;
  sub: string;
}

const remoteJwksCache = new Map<string, JWTVerifyGetKey>();

function keySourceFor(env: AccessEnv): JWTVerifyGetKey {
  if (env.TEST_ACCESS_JWKS) {
    const jwk = JSON.parse(env.TEST_ACCESS_JWKS) as Record<string, unknown>;
    return (async () => importJWK(jwk as never, "RS256")) as JWTVerifyGetKey;
  }
  const url = `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  let jwks = remoteJwksCache.get(url);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(url));
    remoteJwksCache.set(url, jwks);
  }
  return jwks;
}

function forbid(c: Context, code: string): Response {
  return c.json({ error: code }, 403);
}

export async function requireAccessIdentity(
  c: Context<{ Bindings: AccessEnv; Variables: { identity: AccessIdentity } }>,
  next: Next,
): Promise<Response | void> {
  // Default-off: the privileged surface does not exist unless explicitly
  // enabled (I12).
  if (c.env.DEMO_ADMIN_ENABLED !== "true") return c.notFound();
  if (!c.env.ACCESS_TEAM_DOMAIN || !c.env.ACCESS_AUD) {
    // Enabled but unconfigured is a hard failure, never signature-only.
    return forbid(c, "ACCESS_NOT_CONFIGURED");
  }
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (!token) return forbid(c, "ACCESS_MISSING_ASSERTION");
  let payload;
  try {
    ({ payload } = await jwtVerify(token, keySourceFor(c.env), {
      issuer: `https://${c.env.ACCESS_TEAM_DOMAIN}`,
      audience: c.env.ACCESS_AUD,
    }));
  } catch {
    return forbid(c, "ACCESS_INVALID_ASSERTION");
  }
  const email = String(payload.email ?? "");
  if (!email.toLowerCase().endsWith("@anthropic.com")) {
    return forbid(c, "ACCESS_DOMAIN_DENIED");
  }
  c.set("identity", { email, sub: String(payload.sub ?? "") });
  await next();
}
