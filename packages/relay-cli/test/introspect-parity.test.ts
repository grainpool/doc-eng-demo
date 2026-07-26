// Invariant I3 — the point of Phase 07: for EVERY command, the usage string
// in `introspect --json` is EXACTLY what `--help` prints. Both are captured
// from the built CLI as separate processes, so nothing here can share state.
import { describe, expect, it } from "vitest";
import { CliIntrospectionSchema, type CliIntrospection } from "@relay/contracts";
import { runCli } from "./helpers.js";

async function introspection(): Promise<CliIntrospection> {
  const run = await runCli(["introspect", "--json"]);
  expect(run.code).toBe(0);
  return CliIntrospectionSchema.parse(JSON.parse(run.stdout));
}

describe("introspect --json", () => {
  it("validates against the CliIntrospection contract schema", async () => {
    const data = await introspection();
    expect(data.commands.length).toBeGreaterThanOrEqual(19);
    const paths = data.commands.map((c) => c.path);
    for (const expected of [
      "relay",
      "projects", "projects list", "projects create", "projects show",
      "files", "files list", "files upload", "files show",
      "sessions", "sessions list", "sessions create", "sessions run",
      "artifacts", "artifacts list", "artifacts show", "artifacts download",
      "config", "config show", "config status",
      "introspect",
    ]) {
      expect(paths, expected).toContain(expected);
    }
  });

  it("usage === --help output for EVERY command (invariant I3)", async () => {
    const data = await introspection();
    for (const command of data.commands) {
      const args =
        command.path === "relay" ? ["--help"] : [...command.path.split(" "), "--help"];
      const help = await runCli(args);
      expect(help.code, command.path).toBe(0);
      expect(help.stdout, command.path).toBe(command.usage);
    }
  }, 120_000);

  it("every command carries the contractual exit codes and ≥1 example", async () => {
    const data = await introspection();
    for (const command of data.commands) {
      expect(command.exit_codes.map((e) => e.code)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      if (command.path !== "relay") {
        expect(command.examples.length, command.path).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
