// Expansion Phase 5 — the anti-drift gate (expansion contracts.md §5): the
// browser terminal and the installed CLI share ONE grammar authority, the
// CI-gated introspection fixture. If a binding names a command or flag the
// fixture doesn't declare, this fails the build; if the fixture moves (CLI
// change) and a binding silently disagrees, this fails the build.
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BINDINGS } from "../src/terminal/bindings.js";
import { allCommands, commandAt } from "../src/terminal/grammar.js";
import { parseLine, tokenize } from "../src/terminal/parse.js";

describe("terminal ⇄ CLI parity (one grammar, two renderers)", () => {
  it("every binding path exists in the introspection fixture", () => {
    const fixturePaths = new Set(allCommands().map((c) => c.path));
    for (const path of Object.keys(BINDINGS)) {
      expect(fixturePaths.has(path), `binding "${path}" not in fixture`).toBe(true);
    }
  });

  it("every binding's declared flags are a subset of the fixture's flags", () => {
    for (const [path, binding] of Object.entries(BINDINGS)) {
      const command = commandAt(path);
      expect(command, path).toBeDefined();
      const fixtureFlags = new Set(command!.flags.map((f) => f.name));
      for (const flag of binding.flags) {
        expect(fixtureFlags.has(flag), `${path} uses undeclared flag ${flag}`).toBe(true);
      }
    }
  });

  it("help <command> renders the fixture usage text verbatim (I3 in the browser)", () => {
    // The screen prints command.usage line-by-line, unmodified — assert the
    // data path: what commandAt returns IS the fixture byte content.
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    const fixture = JSON.parse(
      readFileSync(join(root, "fixtures", "cli-introspection.json"), "utf8"),
    ) as { commands: { path: string; usage: string }[] };
    for (const path of Object.keys(BINDINGS)) {
      const fromFixture = fixture.commands.find((c) => c.path === path);
      expect(commandAt(path)?.usage, path).toBe(fromFixture?.usage);
    }
  });

  it("parses commands, flags, and quoted arguments per the fixture specs", () => {
    expect(tokenize('sessions run ses_1 "which columns correlate?"')).toEqual([
      "sessions",
      "run",
      "ses_1",
      "which columns correlate?",
    ]);
    const parsed = parseLine('projects create --name "Q3 data" --description Notes');
    expect(parsed.kind).toBe("run");
    if (parsed.kind === "run") {
      expect(parsed.command.path).toBe("projects create");
      expect(parsed.flags["--name"]).toBe("Q3 data");
      expect(parsed.flags["--description"]).toBe("Notes");
      expect(parsed.flagError).toBeNull();
    }
    const unknown = parseLine("sudo rm -rf /");
    expect(unknown.kind).toBe("unknown");
    const undeclaredFlag = parseLine("projects list --format json");
    expect(undeclaredFlag.kind).toBe("run");
    if (undeclaredFlag.kind === "run") expect(undeclaredFlag.flagError).toBe("--format");
  });

  it("the terminal module graph contains no evaluation primitives", () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "terminal");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(join(dir, file), "utf8");
      expect(source, file).not.toMatch(/\beval\s*\(/);
      expect(source, file).not.toMatch(/new\s+Function/);
      expect(source, file).not.toMatch(/import\s*\(\s*[^"']/); // no dynamic import of computed paths
    }
  });
});
