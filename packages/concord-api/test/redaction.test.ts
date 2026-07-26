// Phase 20 — the redaction list is complete and enforced (security.md §6,
// validation.md §8 Logging). Every secret class the system handles is fed
// through the logger and must come out `[redacted]`: Anthropic keys, PEM
// blocks (App private key), GitHub token shapes INCLUDING `ghs_`
// installation tokens, JWT-shaped strings (Cf-Access assertions), and
// every denied KEY regardless of value (cf-access headers, api keys,
// tokens, presigned URLs, prompt/completion text). Operational fields
// (request ids, run ids, fact keys, statuses) must survive untouched.
import { describe, expect, it, vi, afterEach } from "vitest";
import { log, redactString, redactValue } from "../src/log.js";

afterEach(() => vi.restoreAllMocks());

// Sample secrets are ASSEMBLED, never written literally: the pre-commit
// secret scanner greps staged files for exactly these shapes, and a test
// fixture that trips it would be indistinguishable from a real leak.
const ANTHROPIC = ["sk", "ant", "api03", "abc123_XYZ-99"].join("-");
const INSTALL_TOKEN = `gh${"s"}_16C7e42F292c6912E7710c838347Ae178B4a`;
const CLASSIC_PAT = `gh${"p"}_abcdef1234567890`;
const FINE_PAT = `github${"_pat_"}11ABCDEF_something`;
const PEM = `${"-".repeat(5)}BEGIN PRIVATE KEY${"-".repeat(5)}\nMIIEvw==\n${"-".repeat(5)}END PRIVATE KEY${"-".repeat(5)}`;

describe("redaction (security.md §6)", () => {
  it("every secret-shaped VALUE is redacted", () => {
    const cases = [
      ANTHROPIC,
      INSTALL_TOKEN, // GitHub App installation token (Phase 19)
      CLASSIC_PAT,
      FINE_PAT,
      PEM,
      // JWT-shaped (a Cf-Access assertion)
      "eyJhbGciOiJSUzI1NiJ9.eyJlbWFpbCI6ImFAYi5jb20ifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ",
    ];
    for (const secret of cases) {
      const out = redactString(`before ${secret} after`);
      expect(out, secret.slice(0, 12)).not.toContain(secret);
      expect(out).toContain("[redacted]");
    }
  });

  it("denied KEYS are redacted regardless of value, at any nesting depth", () => {
    const out = redactValue({
      "Cf-Access-Jwt-Assertion": "anything",
      authorization: "Bearer whatever",
      api_key: "value",
      GITHUB_APP_PRIVATE_KEY: PEM,
      installation_token: "value",
      presigned_url: "https://r2.example/object?sig=abc",
      prompt: "full prompt text",
      completion: "full completion text",
      nested: { cookie: "session=1", deeper: [{ client_secret: "x" }] },
    }) as Record<string, unknown>;
    expect(out["Cf-Access-Jwt-Assertion"]).toBe("[redacted]");
    expect(out.authorization).toBe("[redacted]");
    expect(out.api_key).toBe("[redacted]");
    expect(out.GITHUB_APP_PRIVATE_KEY).toBe("[redacted]");
    expect(out.installation_token).toBe("[redacted]");
    expect(out.presigned_url).toBe("[redacted]");
    expect(out.prompt).toBe("[redacted]");
    expect(out.completion).toBe("[redacted]");
    const nested = out.nested as Record<string, unknown>;
    expect(nested.cookie).toBe("[redacted]");
    expect((nested.deeper as Record<string, unknown>[])[0].client_secret).toBe("[redacted]");
  });

  it("operational fields survive; emitted line contains no secret", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("cleanup", {
      request_id: "req_1",
      run_id: "run_abc",
      fact_key: "retention.artifact.days",
      status: 204,
      // a careless caller passing a raw token VALUE under an innocent key:
      note: `minted ${INSTALL_TOKEN} for the run`,
    });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).toContain("run_abc");
    expect(line).toContain("retention.artifact.days");
    expect(line).toContain("204");
    expect(line).not.toContain(INSTALL_TOKEN);
    expect(line).toContain("[redacted]");
  });
});
