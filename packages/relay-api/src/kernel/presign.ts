/**
 * Signed dataset URLs (contracts.md §4.3, security.md §3).
 *
 * PLATFORM DEVIATION, recorded in COMPAT.md: native R2 presigning needs
 * S3-compatible access keys, which exist nowhere in this project's operator
 * inventory (operator-runbook.md §7 lists no such credential, and inventing
 * one is forbidden). The objective — a ≤ 60 s, GET-only, single-object-key
 * capability URL — is met by the Worker signing the URL itself (HMAC-SHA256)
 * and serving the object from the R2 binding at GET /api/dataset.
 *
 * Properties enforced here:
 *  - TTL ≤ 60 s (the expiry is inside the signed payload);
 *  - GET only (the method is inside the signed payload, and the route only
 *    accepts GET);
 *  - single object key (the key is inside the signed payload — one signature
 *    authorizes exactly one object).
 *
 * These URLs are capability URLs: never logged (log.ts denies `presigned`/
 * `sig` keys and the route never logs its query string).
 */

const TTL_SECONDS = 60;

const encoder = new TextEncoder();

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function payloadFor(r2Key: string, expiresAt: number): string {
  return `GET\n${r2Key}\n${expiresAt}`;
}

/** Exposed for tests (expired-URL case); production always uses signDatasetUrl. */
export async function signDatasetUrlWithExpiry(
  secret: string,
  origin: string,
  r2Key: string,
  expiresAt: number,
): Promise<string> {
  const sig = await hmacHex(secret, payloadFor(r2Key, expiresAt));
  const params = new URLSearchParams({
    key: r2Key,
    exp: String(expiresAt),
    sig,
  });
  return `${origin}/api/dataset?${params.toString()}`;
}

export function signDatasetUrl(
  secret: string,
  origin: string,
  r2Key: string,
): Promise<string> {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return signDatasetUrlWithExpiry(secret, origin, r2Key, expiresAt);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Returns the authorized r2Key, or null for anything invalid — expired,
 * tampered, or malformed. Callers answer 404 either way (no oracle).
 */
export async function verifyDatasetUrl(
  secret: string,
  url: URL,
): Promise<string | null> {
  const r2Key = url.searchParams.get("key");
  const exp = url.searchParams.get("exp");
  const sig = url.searchParams.get("sig");
  if (!r2Key || !exp || !sig) return null;
  const expiresAt = Number(exp);
  if (!Number.isInteger(expiresAt)) return null;
  if (expiresAt < Math.floor(Date.now() / 1000)) return null;
  const expected = await hmacHex(secret, payloadFor(r2Key, expiresAt));
  return timingSafeEqualHex(expected, sig) ? r2Key : null;
}
