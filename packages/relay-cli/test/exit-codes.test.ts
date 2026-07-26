// Each contractual exit code (contracts.md §7) produced by its triggering
// condition, against a local stub API so the mapping — not the network — is
// what's under test.
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCli } from "./helpers.js";

let server: Server;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/api/projects/prj_missing") {
      respond(404, { error: { code: "NOT_FOUND" } });
    } else if (req.url === "/api/projects" && req.method === "POST") {
      respond(422, { error: { code: "VALIDATION_FAILED", field: "name" } });
    } else if (req.url === "/api/health") {
      respond(req.headers.authorization === "Bearer good" ? 200 : 401, {
        error: { code: "AUTH" },
      });
    } else {
      respond(500, { error: { code: "INTERNAL" } });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
});

afterAll(() => {
  server.close();
});

describe("contractual exit codes", () => {
  it("0 — success (introspect needs no API)", async () => {
    expect((await runCli(["introspect", "--json"])).code).toBe(0);
  });

  it("2 — usage error: missing required flag", async () => {
    expect((await runCli(["projects", "create"])).code).toBe(2);
  });

  it("2 — usage error: unknown command", async () => {
    expect((await runCli(["frobnicate"])).code).toBe(2);
  });

  it("3 — auth failure: API answers 401", async () => {
    expect(
      (await runCli(["--api-url", base, "config", "status"])).code,
    ).toBe(3);
  });

  it("4 — not found: unknown project id", async () => {
    expect(
      (await runCli(["--api-url", base, "projects", "show", "prj_missing"])).code,
    ).toBe(4);
  });

  it("5 — validation failure: API rejects the payload", async () => {
    expect(
      (await runCli(["--api-url", base, "projects", "create", "--name", "x"])).code,
    ).toBe(5);
  });

  it("5 — validation failure: unreadable upload path", async () => {
    expect(
      (
        await runCli([
          "--api-url",
          base,
          "files",
          "upload",
          "prj_x",
          "./definitely-not-a-file.csv",
        ])
      ).code,
    ).toBe(5);
  });

  it("6 — remote unavailable: connection refused", async () => {
    expect(
      (
        await runCli([
          "--api-url",
          "http://127.0.0.1:9",
          "config",
          "status",
        ])
      ).code,
    ).toBe(6);
  });
});
