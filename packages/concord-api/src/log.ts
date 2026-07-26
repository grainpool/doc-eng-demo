/**
 * Structured JSON logger with the redaction rules from security.md §6 —
 * the concord-api twin of relay-api/src/log.ts (each Worker owns its copy;
 * completeness is enforced by test/redaction.test.ts). Never logged:
 * API keys, GitHub App key material or installation tokens, Cf-Access
 * header values / JWTs, prompt or completion text, presigned URLs.
 */

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]+/g,
  /-----BEGIN[\s\S]*?-----/g,
  /ghp_[A-Za-z0-9]+/g,
  /ghs_[A-Za-z0-9]+/g, // GitHub App installation tokens (Phase 19)
  /github_pat_[A-Za-z0-9_]+/g,
  // JWT-shaped strings (Cf-Access assertions and friends)
  /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

// Keys whose values are never logged, regardless of content (security.md §6).
const DENIED_KEY_PATTERNS: RegExp[] = [
  /^cf-access/i,
  /authorization/i,
  /cookie/i,
  /api[_-]?key/i,
  /secret/i,
  /token/i,
  /private[_-]?key/i,
  /presigned/i,
  /^sig$/i,
  /^prompt$/i,
  /^completion$/i,
];

export function redactString(value: string): string {
  let out = value;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    out = out.replace(pattern, "[redacted]");
  }
  return out;
}

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = DENIED_KEY_PATTERNS.some((p) => p.test(k))
        ? "[redacted]"
        : redactValue(v);
    }
    return out;
  }
  return value;
}

export function log(event: string, fields: Record<string, unknown>): void {
  const entry = {
    ts: new Date().toISOString(),
    event,
    ...(redactValue(fields) as Record<string, unknown>),
  };
  console.log(JSON.stringify(entry));
}
