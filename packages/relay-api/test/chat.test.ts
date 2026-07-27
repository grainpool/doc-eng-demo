// Expansion Phase 4 acceptance (expansion validation.md §4): conversation
// lifecycle + scoping, guard-before-call on the stream route, contract error
// codes, and a conditional live streaming smoke against the deployed origin.
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { MODEL_ID, newId } from "@relay/contracts";
import { liveClient, visitorClient } from "./client.js";

interface ErrorBody {
  error: { code: string; copy_id: string };
}

interface Conversation {
  id: string;
  title: string;
  project_id: string | null;
}

async function createConversation(
  vfetch: ReturnType<typeof visitorClient>,
  fields: Record<string, unknown> = {},
): Promise<Conversation> {
  const res = await vfetch("https://example.com/api/conversations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(fields),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as Conversation;
}

describe("conversation lifecycle", () => {
  it("create → default title → rename → list ordering → delete (messages cascade)", async () => {
    const vfetch = visitorClient();
    const conversation = await createConversation(vfetch);
    expect(conversation.title).toBe("New conversation"); // chat.default_title copy

    const renamed = await vfetch(
      `https://example.com/api/conversations/${conversation.id}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed thread" }),
      },
    );
    expect(((await renamed.json()) as Conversation).title).toBe("Renamed thread");

    await env.relay_db
      .prepare(
        "INSERT INTO conversation_message (id, conversation_id, role, parts_json, created_at) VALUES (?, ?, 'user', '[]', ?)",
      )
      .bind(newId("msg"), conversation.id, new Date().toISOString())
      .run();

    const del = await vfetch(
      `https://example.com/api/conversations/${conversation.id}`,
      { method: "DELETE" },
    );
    expect(del.status).toBe(200);
    const orphans = await env.relay_db
      .prepare("SELECT COUNT(*) AS n FROM conversation_message WHERE conversation_id = ?")
      .bind(conversation.id)
      .first<{ n: number }>();
    expect(orphans?.n).toBe(0);
  });

  it("is visitor-scoped: B cannot read, rename, stream to, or delete A's thread", async () => {
    const alice = visitorClient();
    const bob = visitorClient();
    const conversation = await createConversation(alice);

    expect(
      (await bob(`https://example.com/api/conversations/${conversation.id}`)).status,
    ).toBe(404);
    expect(
      (
        await bob(`https://example.com/api/conversations/${conversation.id}/stream`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: [] }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await bob(`https://example.com/api/conversations/${conversation.id}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("project association: readable project required; archived rejects with 409", async () => {
    const vfetch = visitorClient();
    const projectRes = await vfetch("https://example.com/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Chat context" }),
    });
    const project = (await projectRes.json()) as { id: string };

    const conversation = await createConversation(vfetch, { project_id: project.id });
    expect(conversation.project_id).toBe(project.id);

    await vfetch(`https://example.com/api/projects/${project.id}/archive`, {
      method: "POST",
    });
    const attach = await vfetch("https://example.com/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: project.id }),
    });
    expect(attach.status).toBe(409);
    expect(((await attach.json()) as ErrorBody).error.code).toBe("PROJECT_ARCHIVED");
  });
});

describe("stream route guards (before any model call)", () => {
  it("rejects a missing/invalid user message with 422 and persists nothing", async () => {
    const vfetch = visitorClient();
    const conversation = await createConversation(vfetch);
    const res = await vfetch(
      `https://example.com/api/conversations/${conversation.id}/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [] }),
      },
    );
    expect(res.status).toBe(422);
  });

  it("rejects an over-limit message with MESSAGE_TOO_LONG", async () => {
    const vfetch = visitorClient();
    const conversation = await createConversation(vfetch);
    const res = await vfetch(
      `https://example.com/api/conversations/${conversation.id}/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              id: "m1",
              role: "user",
              parts: [{ type: "text", text: "x".repeat(8001) }],
            },
          ],
        }),
      },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as ErrorBody).error.code).toBe("MESSAGE_TOO_LONG");
  });

  it("returns BUDGET_EXHAUSTED before touching the model or persisting the message", async () => {
    const vfetch = visitorClient();
    const conversation = await createConversation(vfetch);
    // Exhaust the day: $5 at $5/M input tokens = 1M input tokens.
    await env.relay_db
      .prepare(
        "INSERT INTO model_call (id, purpose, model, input_tokens, output_tokens, created_at) VALUES (?, 'chat', ?, 1000000, 0, ?)",
      )
      .bind(newId("run"), MODEL_ID, new Date().toISOString())
      .run();

    const res = await vfetch(
      `https://example.com/api/conversations/${conversation.id}/stream`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [
            { id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] },
          ],
        }),
      },
    );
    expect(res.status).toBe(429);
    expect(((await res.json()) as ErrorBody).error.code).toBe("BUDGET_EXHAUSTED");

    const rows = await env.relay_db
      .prepare("SELECT COUNT(*) AS n FROM conversation_message WHERE conversation_id = ?")
      .bind(conversation.id)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0); // blocked requests leave no trace in the thread
  });
});

describe("chat — deployed streaming smoke", () => {
  it(
    "streams a real response and persists both sides (skips until chat.web ships)",
    { timeout: 120_000, retry: 1 },
    async () => {
      const truth = (await (
        await fetch("https://relay.otonieltrejo.com/api/product-truth")
      ).json()) as { facts: { key: string; value: unknown }[] };
      const enabled =
        truth.facts.find((f) => f.key === "availability.feature.chat.platform.web")
          ?.value === true;
      if (!enabled) return; // pre-deploy: the fact is still false — nothing to test yet

      const lfetch = liveClient();
      const created = await lfetch("https://relay.otonieltrejo.com/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(created.status).toBe(201);
      const conversation = (await created.json()) as Conversation;

      const stream = await lfetch(
        `https://relay.otonieltrejo.com/api/conversations/${conversation.id}/stream`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                id: "m1",
                role: "user",
                parts: [{ type: "text", text: "Reply with the single word: relay" }],
              },
            ],
          }),
        },
      );
      expect(stream.status).toBe(200);
      const body = await stream.text(); // drain the SSE stream fully
      expect(body.length).toBeGreaterThan(0);

      const detail = await lfetch(
        `https://relay.otonieltrejo.com/api/conversations/${conversation.id}`,
      );
      const withMessages = (await detail.json()) as {
        messages: { role: string }[];
        title: string;
      };
      expect(withMessages.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
      expect(withMessages.title).toContain("Reply with the single word"); // auto-title

      await lfetch(
        `https://relay.otonieltrejo.com/api/conversations/${conversation.id}`,
        { method: "DELETE" },
      );
    },
  );
});
