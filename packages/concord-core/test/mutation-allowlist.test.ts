// Phase 18 — mutation allowlists (security.md §4.1/§4.2): an off-allowlist
// key is rejected BEFORE value validation; off-enum values rejected; the
// doc-body size cap; and every forbidden content pattern individually.
import { describe, expect, it } from "vitest";
import { FACT_MUTATION_ALLOWLIST } from "@relay/contracts";
import { validateDocBody, validateMutation } from "../src/mutation-validate.js";

const EDITABLE = ["helpcenter:help-center/articles/upload-failed.md#article"];

describe("fact mutation allowlist (§4.1 — nine keys, closed values)", () => {
  it("the table is exactly the nine documented keys", () => {
    expect(Object.keys(FACT_MUTATION_ALLOWLIST).sort()).toEqual(
      [
        "analysis.operation.distribution_test.enabled",
        "availability.feature.analysis_sessions.platform.android",
        "availability.feature.analysis_sessions.platform.ios",
        "availability.feature.connector_drive.platform.web",
        "flag.analysis.regression_enabled",
        "limit.upload.csv.max_bytes",
        "plan.feature.analysis_sessions.min_plan",
        "retention.artifact.days",
        "term.canonical.task",
      ].sort(),
    );
  });

  it("an off-allowlist key is MUTATION_NOT_ALLOWED before value validation", () => {
    // The VALUE here would be valid for other keys — the key check comes first.
    const verdict = validateMutation(
      { kind: "fact_value", fact_key: "limit.upload.csv.max_rows", value: 10485760 },
      EDITABLE,
    );
    expect(verdict).toMatchObject({ ok: false, code: "MUTATION_NOT_ALLOWED" });
  });

  it("an off-enum value is rejected", () => {
    const verdict = validateMutation(
      { kind: "fact_value", fact_key: "limit.upload.csv.max_bytes", value: 999_999_999 },
      EDITABLE,
    );
    expect(verdict).toMatchObject({ ok: false, code: "MUTATION_VALUE_NOT_ALLOWED" });
    // Type coercion does not sneak through the closed set:
    expect(
      validateMutation(
        { kind: "fact_value", fact_key: "limit.upload.csv.max_bytes", value: "10485760" },
        EDITABLE,
      ),
    ).toMatchObject({ ok: false });
  });

  it("every allowlisted (key, value) pair passes", () => {
    for (const [key, values] of Object.entries(FACT_MUTATION_ALLOWLIST)) {
      for (const value of values) {
        expect(validateMutation({ kind: "fact_value", fact_key: key, value }, EDITABLE)).toEqual({
          ok: true,
        });
      }
    }
  });
});

describe("doc-body mutations (§4.2 — MDX is executable)", () => {
  it("only ids in editable-units.json are writable", () => {
    const verdict = validateMutation(
      { kind: "doc_body", doc_unit_id: "generated:generated/availability-matrix.mdx#page", body: "x" },
      EDITABLE,
    );
    expect(verdict).toMatchObject({ ok: false, code: "MUTATION_NOT_ALLOWED" });
  });

  it("oversized bodies are rejected (8192-byte cap)", () => {
    const verdict = validateDocBody("a".repeat(8193));
    expect(verdict).toMatchObject({ ok: false, code: "MUTATION_BODY_TOO_LARGE" });
  });

  it("each forbidden content pattern is rejected individually", () => {
    const cases: [string, string][] = [
      ["script tag", "hello <script>alert(1)</script>"],
      ["iframe tag", "<iframe src='https://otonieltrejo.com'></iframe>"],
      ["object tag", "<object data='x'></object>"],
      ["embed tag", "<embed src='x'>"],
      ["event handler", "<img src=x onerror=alert(1)>"],
      ["javascript uri", "[click](javascript:alert(1))"],
      ["mdx braces", "the limit is {process.env.SECRET}"],
      ["import statement", "import Evil from 'evil'\n\nBody."],
      ["export statement", "export const x = 1\n\nBody."],
      ["jsx outside allowlist", "<DataFetcher url='https://otonieltrejo.com' />"],
    ];
    for (const [name, body] of cases) {
      expect(validateDocBody(body), name).toMatchObject({ ok: false, code: "MUTATION_CONTENT_FORBIDDEN" });
    }
  });

  it("plain markdown and allowlisted components pass", () => {
    expect(validateDocBody("**The file is too big.** Split it by date range.")).toEqual({ ok: true });
    expect(validateDocBody("<Note>Files up to 10 MB are supported.</Note>")).toEqual({ ok: true });
  });
});
