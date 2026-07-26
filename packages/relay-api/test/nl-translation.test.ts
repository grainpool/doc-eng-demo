// Phase 05: the NL layer is a ROUTER, never an executor. These tests drive
// runTurn with a KERNEL SPY and a fake Messages client to assert the
// load-bearing safety property: the kernel receives only a validated
// {operation_id, params} pair, and unsupported/invalid paths make ZERO
// kernel calls. The deployed block then runs four real prompts end-to-end.
import { SELF, env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type {
  DatasetRef,
  KernelResult,
  OperationId,
} from "@relay/contracts";
import { runTurn } from "../src/analysis/turn.js";
import type {
  MessageLike,
  MessagesClient,
} from "../src/analysis/translator.js";
import type {
  AnalysisKernel,
  KernelOpResponse,
} from "../src/kernel/types.js";
import type { FileRow } from "../src/routes/files.js";

// ---------------------------------------------------------------- fixtures

const CANNED_RESULT: KernelResult = {
  operation_id: "correlation_matrix",
  scalar_result: { method: "pearson", columns: 2 },
  tables: [
    {
      name: "correlation",
      columns: ["column", "a", "b"],
      rows: [["a", 1, 0.5], ["b", 0.5, 1]],
      truncated: false,
    },
  ],
  plots: [],
  versions: { pandas: "3.0.5" },
  duration_ms: 12,
};

class KernelSpy implements AnalysisKernel {
  calls: { operationId: OperationId; dataset: DatasetRef; params: unknown }[] = [];

  op(
    operationId: OperationId,
    dataset: DatasetRef,
    params: unknown,
  ): Promise<KernelOpResponse> {
    this.calls.push({ operationId, dataset, params });
    return Promise.resolve({
      status: 200,
      body: { ...CANNED_RESULT, operation_id: operationId },
    });
  }

  versions(): never {
    throw new Error("not used");
  }
  operations(): never {
    throw new Error("not used");
  }
  health(): never {
    throw new Error("not used");
  }
}

function textMessage(payload: unknown): MessageLike {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(payload) }],
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}

function clientReturning(...messages: MessageLike[]): MessagesClient {
  let i = 0;
  return {
    create: () => {
      const message = messages[Math.min(i, messages.length - 1)] as MessageLike;
      i++;
      return Promise.resolve(message);
    },
  };
}

let file: FileRow;
let session: { id: string };

beforeAll(async () => {
  const projectRes = await SELF.fetch("https://example.com/api/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "nl translation test" }),
  });
  const project = (await projectRes.json()) as { id: string };
  const form = new FormData();
  form.set(
    "file",
    new File(["a,b\n1,2\n3,4\n5,6\n"], "nums.csv", { type: "text/csv" }),
  );
  const fileRes = await SELF.fetch(
    `https://example.com/api/projects/${project.id}/files`,
    { method: "POST", body: form },
  );
  file = (await fileRes.json()) as FileRow;
  const sessionRes = await SELF.fetch(
    `https://example.com/api/projects/${project.id}/sessions`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file_id: file.id }),
    },
  );
  session = (await sessionRes.json()) as { id: string };
});

describe("runTurn — router safety properties", () => {
  it("unsupported request → kind unsupported and ZERO kernel calls", async () => {
    const spy = new KernelSpy();
    const outcome = await runTurn(
      env,
      {
        client: clientReturning(
          textMessage({
            kind: "unsupported",
            reason: "Model training is not one of the supported operations.",
            supported_alternatives: ["summary_statistics", "correlation_matrix"],
          }),
        ),
        kernel: spy,
      },
      session,
      file,
      "train a random forest on this",
      "https://example.com",
    );
    expect(outcome.http).toBe(200);
    expect(outcome.body.status).toBe("refused");
    expect(outcome.body.copy_id).toBe("error.analysis.unsupported_request");
    expect(spy.calls.length).toBe(0);

    const row = await env.relay_db
      .prepare("SELECT status FROM session_turn WHERE id = ?")
      .bind(outcome.body.turn_id as string)
      .first<{ status: string }>();
    expect(row?.status).toBe("refused");
  });

  it("well-formed request → the expected operation id and params reach the kernel", async () => {
    const spy = new KernelSpy();
    const outcome = await runTurn(
      env,
      {
        client: clientReturning(
          textMessage({
            kind: "operation",
            operation_id: "correlation_matrix",
            params_json: JSON.stringify({ method: "spearman" }),
            rationale: "Correlation across numeric columns.",
          }),
        ),
        kernel: spy,
      },
      session,
      file,
      "which columns correlate?",
      "https://example.com",
    );
    expect(outcome.http).toBe(200);
    expect(outcome.body.status).toBe("completed");
    expect(spy.calls.length).toBe(1);
    expect(spy.calls[0]?.operationId).toBe("correlation_matrix");
    expect(spy.calls[0]?.params).toEqual({ method: "spearman" });
    // The kernel got a signed capability URL, not a raw location.
    expect(spy.calls[0]?.dataset.presigned_url).toContain("/api/dataset?");
    expect(spy.calls[0]?.dataset.sha256).toBe(file.sha256);

    // model_call rows recorded with purpose + token counts.
    const call = await env.relay_db
      .prepare(
        "SELECT purpose, input_tokens, output_tokens, prompt_hash FROM model_call WHERE turn_id = ?",
      )
      .bind(outcome.body.turn_id as string)
      .first<{ purpose: string; input_tokens: number; output_tokens: number; prompt_hash: string }>();
    expect(call?.purpose).toBe("nl_translation");
    expect(call?.input_tokens).toBe(100);
    expect(call?.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("params failing the operation schema → 422 and ZERO kernel calls", async () => {
    const spy = new KernelSpy();
    const outcome = await runTurn(
      env,
      {
        client: clientReturning(
          textMessage({
            kind: "operation",
            operation_id: "linear_regression",
            // dependent must be a string; independents must be an array
            params_json: JSON.stringify({ dependent: 123, independents: "b" }),
            rationale: "bad params",
          }),
        ),
        kernel: spy,
      },
      session,
      file,
      "regress a on b",
      "https://example.com",
    );
    expect(outcome.http).toBe(422);
    expect(spy.calls.length).toBe(0);
    const error = outcome.body.error as { code: string; copy_id: string };
    expect(error.code).toBe("VALIDATION_FAILED");
    expect(error.copy_id).toBe("error.analysis.invalid_params");
  });

  it("stop_reason refusal → surfaced as unsupported WITHOUT reading content", async () => {
    const spy = new KernelSpy();
    let contentRead = false;
    const refusalMessage = {
      stop_reason: "refusal",
      usage: { input_tokens: 50, output_tokens: 0 },
    } as MessageLike;
    Object.defineProperty(refusalMessage, "content", {
      get(): MessageLike["content"] {
        contentRead = true;
        return [];
      },
    });
    const outcome = await runTurn(
      env,
      { client: clientReturning(refusalMessage), kernel: spy },
      session,
      file,
      "anything",
      "https://example.com",
    );
    expect(outcome.http).toBe(200);
    expect(outcome.body.status).toBe("refused");
    expect(contentRead).toBe(false);
    expect(spy.calls.length).toBe(0);
  });

  it("schema-invalid output retries once with the error, then returns unsupported", async () => {
    const spy = new KernelSpy();
    const outcome = await runTurn(
      env,
      {
        client: clientReturning(
          textMessage({ kind: "operation", operation_id: "not_an_op" }),
          textMessage({ nonsense: true }),
        ),
        kernel: spy,
      },
      session,
      file,
      "gibberish request",
      "https://example.com",
    );
    expect(outcome.http).toBe(200);
    expect(outcome.body.status).toBe("refused");
    expect(spy.calls.length).toBe(0);
    const usage = outcome.body.model_usage as { calls: number };
    expect(usage.calls).toBe(2); // exactly one retry, never more
  });
});

// --------------------------------------------------------------- deployed

const DEPLOYED = "https://relay.otonieltrejo.com";

describe("deployed — four NL prompts resolve to four different operations", () => {
  it(
    "correlate / summarize / histogram / normality — and an unsupported refusal",
    { timeout: 300_000, retry: 1 },
    async () => {
      const projectRes = await fetch(`${DEPLOYED}/api/projects`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "phase05 integration" }),
      });
      expect(projectRes.status).toBe(201);
      const project = (await projectRes.json()) as { id: string };

      const csv =
        "region,units,price,score\nA,10,2.5,60.0\nB,14,3.4,71.2\nA,11,2.6,62.8\nB,13,3.3,69.9\nA,15,2.9,73.5\nB,8,3.0,55.4\nA,10,2.4,61.2\nB,12,3.2,66.8\n";
      const form = new FormData();
      form.set("file", new File([csv], "sales.csv", { type: "text/csv" }));
      const fileRes = await fetch(`${DEPLOYED}/api/projects/${project.id}/files`, {
        method: "POST",
        body: form,
      });
      expect(fileRes.status).toBe(201);
      const uploaded = (await fileRes.json()) as { id: string };

      const sessionRes = await fetch(
        `${DEPLOYED}/api/projects/${project.id}/sessions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ file_id: uploaded.id }),
        },
      );
      expect(sessionRes.status).toBe(201);
      const liveSession = (await sessionRes.json()) as { id: string };

      const ask = async (prompt: string) => {
        const res = await fetch(
          `${DEPLOYED}/api/sessions/${liveSession.id}/turns`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ prompt }),
          },
        );
        return {
          status: res.status,
          body: (await res.json()) as {
            status?: string;
            operation_id?: string;
            translation?: { kind: string; supported_alternatives?: string[] };
            result?: { tables: unknown[] };
          },
        };
      };

      const cases: [string, string][] = [
        ["which columns correlate with each other?", "correlation_matrix"],
        ["show me summary statistics for units and score", "summary_statistics"],
        ["plot a histogram of score", "plot"],
        ["is score normally distributed?", "distribution_test"],
      ];
      for (const [prompt, expected] of cases) {
        const { status, body } = await ask(prompt);
        expect(status, prompt).toBe(200);
        expect(body.status, prompt).toBe("completed");
        expect(body.operation_id, prompt).toBe(expected);
      }

      // The worst failure mode is silent substitution; the refusal path must
      // actually refuse, with zero kernel work.
      const refusal = await ask("train a random forest classifier on this data");
      expect(refusal.status).toBe(200);
      expect(refusal.body.status).toBe("refused");
      expect(refusal.body.translation?.kind).toBe("unsupported");
    },
  );
});
