// Expansion Phase 2 acceptance (expansion validation.md §2): full project/
// file/session lifecycle, cascade completeness (zero orphaned D1 rows or R2
// objects), two-visitor isolation, seed immutability, and the token-gated
// maintenance reset.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { newId } from "@relay/contracts";
import { visitorClient } from "./client.js";

interface ErrorBody {
  error: { code: string; copy_id: string };
}

async function createProject(
  vfetch: ReturnType<typeof visitorClient>,
  name = "Lifecycle test",
): Promise<string> {
  const res = await vfetch("https://example.com/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function uploadFile(
  vfetch: ReturnType<typeof visitorClient>,
  projectId: string,
  name = "data.csv",
): Promise<string> {
  const form = new FormData();
  form.append("file", new File(["a,b\n1,2\n3,4\n"], name, { type: "text/csv" }));
  const res = await vfetch(`https://example.com/api/projects/${projectId}/files`, {
    method: "POST",
    body: form,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function rowCount(table: string, where: string, id: string): Promise<number> {
  const row = await env.relay_db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where} = ?`)
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Insert a synthetic artifact + provenance + turn so the cascade has every
 *  child kind to clean up (the kernel is absent in the test pool). */
async function plantAnalysisChildren(projectId: string, fileId: string) {
  const now = new Date().toISOString();
  const sessionId = newId("ses");
  const turnId = newId("trn");
  const artifactId = newId("art");
  const turnResultKey = `results/${sessionId}/${turnId}.json`;
  const artifactKey = `artifacts/${projectId}/${artifactId}.csv`;
  await env.relay_db.batch([
    env.relay_db
      .prepare(
        "INSERT INTO analysis_session (id, project_id, file_id, title, created_at) VALUES (?, ?, ?, 'planted', ?)",
      )
      .bind(sessionId, projectId, fileId, now),
    env.relay_db
      .prepare(
        "INSERT INTO session_turn (id, session_id, prompt, status, result_r2_key, created_at) VALUES (?, ?, 'planted', 'completed', ?, ?)",
      )
      .bind(turnId, sessionId, turnResultKey, now),
    env.relay_db
      .prepare(
        "INSERT INTO artifact (id, project_id, kind, name, r2_key, byte_size, created_at) VALUES (?, ?, 'table_csv', 'planted', ?, 10, ?)",
      )
      .bind(artifactId, projectId, artifactKey, now),
    env.relay_db
      .prepare(
        `INSERT INTO artifact_provenance (artifact_id, source_file_id, source_file_sha256,
          operation_id, params_json, params_hash, runtime_versions_json, kernel_image_digest,
          session_id, turn_id, generated_at, duration_ms)
         VALUES (?, ?, 'sha', 'summary_statistics', '{}', 'hash', '{}', 'digest', ?, ?, ?, 1)`,
      )
      .bind(artifactId, fileId, sessionId, turnId, now),
  ]);
  await env.relay_artifacts.put(turnResultKey, '{"planted":true}');
  await env.relay_artifacts.put(artifactKey, "a,b\n1,2\n");
  return { sessionId, turnId, artifactId, turnResultKey, artifactKey };
}

describe("project lifecycle", () => {
  it("create → rename → archive (writes 409) → unarchive → delete", async () => {
    const vfetch = visitorClient();
    const id = await createProject(vfetch, "Before rename");

    const renamed = await vfetch(`https://example.com/api/projects/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "After rename" }),
    });
    expect(renamed.status).toBe(200);
    expect(((await renamed.json()) as { name: string }).name).toBe("After rename");

    const archived = await vfetch(`https://example.com/api/projects/${id}/archive`, {
      method: "POST",
    });
    expect(archived.status).toBe(200);
    expect(((await archived.json()) as { state: string }).state).toBe("archived");

    // Writes are rejected while archived — upload and session creation both.
    const form = new FormData();
    form.append("file", new File(["a\n1\n"], "x.csv", { type: "text/csv" }));
    const upload = await vfetch(`https://example.com/api/projects/${id}/files`, {
      method: "POST",
      body: form,
    });
    expect(upload.status).toBe(409);
    expect(((await upload.json()) as ErrorBody).error.code).toBe("PROJECT_ARCHIVED");

    const unarchived = await vfetch(`https://example.com/api/projects/${id}/unarchive`, {
      method: "POST",
    });
    expect(((await unarchived.json()) as { state: string }).state).toBe("active");

    const deleted = await vfetch(`https://example.com/api/projects/${id}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    const gone = await vfetch(`https://example.com/api/projects/${id}`);
    expect(gone.status).toBe(404);
  });

  it("delete cascades: zero orphaned rows in any child table, zero orphaned R2 objects", async () => {
    const vfetch = visitorClient();
    const projectId = await createProject(vfetch);
    const fileId = await uploadFile(vfetch, projectId);
    const planted = await plantAnalysisChildren(projectId, fileId);

    const fileRow = await env.relay_db
      .prepare("SELECT r2_key FROM file WHERE id = ?")
      .bind(fileId)
      .first<{ r2_key: string }>();

    const res = await vfetch(`https://example.com/api/projects/${projectId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { counts: Record<string, number> };
    expect(body.counts.files).toBe(1);
    expect(body.counts.sessions).toBe(1);
    expect(body.counts.artifacts).toBe(1);

    expect(await rowCount("file", "project_id", projectId)).toBe(0);
    expect(await rowCount("analysis_session", "project_id", projectId)).toBe(0);
    expect(await rowCount("session_turn", "session_id", planted.sessionId)).toBe(0);
    expect(await rowCount("artifact", "project_id", projectId)).toBe(0);
    expect(await rowCount("artifact_provenance", "artifact_id", planted.artifactId)).toBe(0);

    expect(await env.relay_artifacts.get(fileRow!.r2_key)).toBeNull();
    expect(await env.relay_artifacts.get(planted.turnResultKey)).toBeNull();
    expect(await env.relay_artifacts.get(planted.artifactKey)).toBeNull();
  });
});

describe("file lifecycle", () => {
  it("download returns the uploaded bytes; delete removes row and R2 object", async () => {
    const vfetch = visitorClient();
    const projectId = await createProject(vfetch);
    const fileId = await uploadFile(vfetch, projectId);

    const download = await vfetch(`https://example.com/api/files/${fileId}/download`);
    expect(download.status).toBe(200);
    expect(download.headers.get("content-disposition")).toContain('filename="data.csv"');
    expect(await download.text()).toBe("a,b\n1,2\n3,4\n");

    const del = await vfetch(`https://example.com/api/files/${fileId}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(await rowCount("file", "id", fileId)).toBe(0);
  });

  it("a session-referenced file returns 409 RESOURCE_IN_USE", async () => {
    const vfetch = visitorClient();
    const projectId = await createProject(vfetch);
    const fileId = await uploadFile(vfetch, projectId);
    await vfetch(`https://example.com/api/projects/${projectId}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: fileId }),
    });
    const del = await vfetch(`https://example.com/api/files/${fileId}`, { method: "DELETE" });
    expect(del.status).toBe(409);
    expect(((await del.json()) as ErrorBody).error.code).toBe("RESOURCE_IN_USE");
  });
});

describe("session lifecycle", () => {
  it("delete removes turns (and their stored results) but artifacts + provenance survive", async () => {
    const vfetch = visitorClient();
    const projectId = await createProject(vfetch);
    const fileId = await uploadFile(vfetch, projectId);
    const planted = await plantAnalysisChildren(projectId, fileId);

    const del = await vfetch(`https://example.com/api/sessions/${planted.sessionId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    expect(await rowCount("session_turn", "session_id", planted.sessionId)).toBe(0);
    expect(await env.relay_artifacts.get(planted.turnResultKey)).toBeNull();
    // History is immutable where it matters: the artifact and its provenance stay.
    expect(await rowCount("artifact", "id", planted.artifactId)).toBe(1);
    expect(await rowCount("artifact_provenance", "artifact_id", planted.artifactId)).toBe(1);
    expect(await env.relay_artifacts.get(planted.artifactKey)).not.toBeNull();
  });
});

describe("two-visitor isolation", () => {
  it("visitor B cannot list, read, mutate, or delete visitor A's project", async () => {
    const alice = visitorClient();
    const bob = visitorClient();
    const projectId = await createProject(alice, "Alice's project");

    // B's list excludes it.
    const list = await bob("https://example.com/api/projects");
    const projects = ((await list.json()) as { projects: { id: string }[] }).projects;
    expect(projects.find((p) => p.id === projectId)).toBeUndefined();

    // Direct reads and mutations 404 — never 403, ids must not leak existence.
    expect((await bob(`https://example.com/api/projects/${projectId}`)).status).toBe(404);
    expect(
      (
        await bob(`https://example.com/api/projects/${projectId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "hijacked" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await bob(`https://example.com/api/projects/${projectId}`, { method: "DELETE" })).status,
    ).toBe(404);

    // A still sees it untouched.
    const mine = await alice(`https://example.com/api/projects/${projectId}`);
    expect(mine.status).toBe(200);
    expect(((await mine.json()) as { name: string }).name).toBe("Alice's project");
  });

  it("seed content is readable by everyone and mutable by no one", async () => {
    const vfetch = visitorClient();
    const now = new Date().toISOString();
    const seedId = newId("prj");
    await env.relay_db
      .prepare(
        "INSERT INTO project (id, name, state, owner_id, created_at, updated_at) VALUES (?, 'Seeded', 'active', 'seed', ?, ?)",
      )
      .bind(seedId, now, now)
      .run();

    expect((await vfetch(`https://example.com/api/projects/${seedId}`)).status).toBe(200);

    const patch = await vfetch(`https://example.com/api/projects/${seedId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "vandalized" }),
    });
    expect(patch.status).toBe(403);
    expect(((await patch.json()) as ErrorBody).error.code).toBe("SEED_READ_ONLY");

    const del = await vfetch(`https://example.com/api/projects/${seedId}`, { method: "DELETE" });
    expect(del.status).toBe(403);
  });
});

describe("maintenance reset", () => {
  it("404s without the token (indistinguishable from a missing route)", async () => {
    const vfetch = visitorClient();
    const bare = await vfetch("https://example.com/api/internal/reset", { method: "POST" });
    expect(bare.status).toBe(404);
    const wrong = await vfetch("https://example.com/api/internal/reset", {
      method: "POST",
      headers: { authorization: "Bearer wrong" },
    });
    expect(wrong.status).toBe(404);
  });

  it("with the token: wipes content + R2, preserves model_call, reseeds as 'seed'", async () => {
    const vfetch = visitorClient();
    const projectId = await createProject(vfetch);
    const fileId = await uploadFile(vfetch, projectId);
    await plantAnalysisChildren(projectId, fileId);
    await env.relay_db
      .prepare(
        "INSERT INTO model_call (id, purpose, model, input_tokens, output_tokens, created_at) VALUES (?, 'nl_translation', 'test-model', 10, 5, ?)",
      )
      .bind(newId("run"), new Date().toISOString())
      .run();

    const res = await vfetch("https://example.com/api/internal/reset", {
      method: "POST",
      headers: { authorization: "Bearer test-only-maintenance-token" },
    });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { projects: number; wiped_r2_objects: number };
    expect(report.projects).toBe(3); // the deterministic fixture
    expect(report.wiped_r2_objects).toBeGreaterThanOrEqual(3);

    // The old project is gone; every surviving project is seed-owned.
    expect(await rowCount("project", "id", projectId)).toBe(0);
    const owners = await env.relay_db
      .prepare("SELECT DISTINCT owner_id FROM project")
      .all<{ owner_id: string | null }>();
    expect(owners.results).toEqual([{ owner_id: "seed" }]);

    // Spend accounting survives the wipe.
    const calls = await env.relay_db
      .prepare("SELECT COUNT(*) AS n FROM model_call")
      .first<{ n: number }>();
    expect(calls?.n ?? 0).toBeGreaterThanOrEqual(1);
  });
});
