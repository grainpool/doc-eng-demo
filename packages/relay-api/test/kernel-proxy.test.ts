// Phase 04: the Worker side of the kernel path. The vitest pool cannot run
// the container (COMPAT.md), so this file covers three layers honestly:
//  - SELF: routes that need no container (404 unknown op, 422 validation,
//    503 kernel-unavailable — the pool genuinely HAS no KERNEL binding),
//    plus the signed dataset capability URL end-to-end against real R2.
//  - unit: ContainerKernel retry/timeout and the kernel-response mapping for
//    sha256-mismatch / oversized-dataset 400s via a stubbed kernel transport.
//    The kernel-side behaviors themselves are asserted for real by
//    relay-kernel/tests/test_operations.py against the pinned image.
import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ContainerKernel } from "../src/kernel/container-kernel.js";
import { mapKernelResponse } from "../src/routes/kernel-internal.js";
import {
  signDatasetUrl,
  signDatasetUrlWithExpiry,
  verifyDatasetUrl,
} from "../src/kernel/presign.js";

const SECRET = "test-only-dataset-secret";

async function createProjectWithFile(): Promise<{ fileId: string }> {
  const projectRes = await SELF.fetch("https://example.com/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "kernel proxy test" }),
  });
  expect(projectRes.status).toBe(201);
  const project = (await projectRes.json()) as { id: string };

  const form = new FormData();
  form.set(
    "file",
    new File(["a,b\n1,2\n3,4\n"], "tiny.csv", { type: "text/csv" }),
  );
  const fileRes = await SELF.fetch(
    `https://example.com/api/projects/${project.id}/files`,
    { method: "POST", body: form },
  );
  expect(fileRes.status).toBe(201);
  const file = (await fileRes.json()) as { id: string };
  return { fileId: file.id };
}

describe("POST /api/internal/kernel/op/:id — Worker-side gates", () => {
  it("unknown operation id is a 404 (closed enum, checked first)", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/internal/kernel/op/drop_table",
      { method: "POST", body: JSON.stringify({ file_id: "fil_x" }) },
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("missing file_id is a 422", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/internal/kernel/op/inspect_schema",
      { method: "POST", body: JSON.stringify({}) },
    );
    expect(res.status).toBe(422);
  });

  it("params failing the operation's Zod schema are a 422 before any kernel call", async () => {
    const { fileId } = await createProjectWithFile();
    const res = await SELF.fetch(
      "https://example.com/api/internal/kernel/op/filter_rows",
      {
        method: "POST",
        body: JSON.stringify({
          file_id: fileId,
          params: {
            predicates: [{ column: "a", op: "matches_regex", value: ".*" }],
          },
        }),
      },
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { copy_id: string } };
    expect(body.error.copy_id).toBe("error.analysis.invalid_params");
  });

  it("unknown file_id is a 404", async () => {
    const res = await SELF.fetch(
      "https://example.com/api/internal/kernel/op/inspect_schema",
      {
        method: "POST",
        body: JSON.stringify({ file_id: "fil_00000000000000000000000000" }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("kernel unavailable (no binding in the pool) is a 503 with the right copy id", async () => {
    const { fileId } = await createProjectWithFile();
    const res = await SELF.fetch(
      "https://example.com/api/internal/kernel/op/inspect_schema",
      { method: "POST", body: JSON.stringify({ file_id: fileId }) },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: { code: string; copy_id: string };
    };
    expect(body.error.code).toBe("KERNEL_UNAVAILABLE");
    expect(body.error.copy_id).toBe("error.analysis.kernel_unavailable");
  });
});

describe("kernel error mapping (stubbed kernel transport)", () => {
  it("kernel sha256_mismatch 400 surfaces as a 400 with the kernel's code", () => {
    const mapped = mapKernelResponse({
      status: 400,
      body: {
        error: { code: "sha256_mismatch", detail: "dataset sha256 does not match" },
      },
    });
    expect(mapped.status).toBe(400);
    const body = mapped.body as { error: { code: string; detail: string } };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.detail).toContain("sha256_mismatch");
  });

  it("kernel dataset_too_large 400 surfaces as a 400", () => {
    const mapped = mapKernelResponse({
      status: 400,
      body: { error: { code: "dataset_too_large", detail: "dataset exceeds max_bytes" } },
    });
    expect(mapped.status).toBe(400);
    expect(
      (mapped.body as { error: { detail: string } }).error.detail,
    ).toContain("dataset_too_large");
  });

  it("a 200 that fails the KernelResult contract is a 503, not a pass-through", () => {
    const mapped = mapKernelResponse({ status: 200, body: { nonsense: true } });
    expect(mapped.status).toBe(503);
  });

  it("ContainerKernel retries a failed transport once, then succeeds", async () => {
    let calls = 0;
    const kernel = new ContainerKernel({
      fetch: async () => {
        calls += 1;
        if (calls === 1) throw new Error("connection reset");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      },
    });
    const res = await kernel.op(
      "inspect_schema",
      {
        presigned_url: "https://relay.otonieltrejo.com/api/dataset?x=1",
        format: "csv",
        sha256: "0".repeat(64),
        max_bytes: 1,
      },
      {},
    );
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  it("ContainerKernel gives up after the single retry", async () => {
    let calls = 0;
    const kernel = new ContainerKernel({
      fetch: async () => {
        calls += 1;
        throw new Error("still down");
      },
    });
    await expect(
      kernel.op(
        "inspect_schema",
        {
          presigned_url: "https://relay.otonieltrejo.com/api/dataset?x=1",
          format: "csv",
          sha256: "0".repeat(64),
          max_bytes: 1,
        },
        {},
      ),
    ).rejects.toThrow("kernel unavailable");
    expect(calls).toBe(2);
  });
});

describe("GET /api/dataset — signed capability URL", () => {
  it("serves exactly the signed object, and only while valid", async () => {
    const key = "files/prj_t/fil_t/probe.csv";
    await env.relay_artifacts.put(key, "a,b\n1,2\n");

    const url = await signDatasetUrl(SECRET, "https://example.com", key);
    const ok = await SELF.fetch(url);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("a,b\n1,2\n");

    // Tampered signature → 404 (no oracle).
    const tampered = url.replace(/sig=.{8}/, "sig=00000000");
    expect((await SELF.fetch(tampered)).status).toBe(404);

    // Expired → 404.
    const expired = await signDatasetUrlWithExpiry(
      SECRET,
      "https://example.com",
      key,
      Math.floor(Date.now() / 1000) - 5,
    );
    expect((await SELF.fetch(expired)).status).toBe(404);

    // A signature authorizes exactly ONE key.
    const other = new URL(url);
    other.searchParams.set("key", "files/prj_t/fil_t/other.csv");
    expect((await SELF.fetch(other.toString())).status).toBe(404);

    await env.relay_artifacts.delete(key);
  });

  it("the TTL baked into signDatasetUrl is ≤ 60 s", async () => {
    const url = new URL(
      await signDatasetUrl(SECRET, "https://example.com", "k"),
    );
    const exp = Number(url.searchParams.get("exp"));
    const ttl = exp - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    // And the verifier accepts its own signature.
    expect(await verifyDatasetUrl(SECRET, url)).toBe("k");
  });
});
