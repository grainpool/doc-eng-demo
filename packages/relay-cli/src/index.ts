#!/usr/bin/env node
/**
 * `relay` — Relay's CLI (Phase 07). Program tree in program.ts; the
 * `introspect` command is the T2_CLI authority source. Exit codes are
 * contractual (contracts.md §7) and mapped in one place here.
 */
import { CommanderError } from "commander";
import { buildProgram } from "./program.js";
import { CliError, EXIT } from "./errors.js";

export async function main(argv: string[]): Promise<number> {
  const program = buildProgram();
  program.exitOverride(); // we own process.exit — commander must not call it
  try {
    await program.parseAsync(argv, { from: "user" });
    return EXIT.OK;
  } catch (e) {
    if (e instanceof CommanderError) {
      // help/version display exits 0; every real commander error is usage.
      if (e.code === "commander.helpDisplayed" || e.code === "commander.version") {
        return EXIT.OK;
      }
      if (e.code === "commander.help") return EXIT.OK;
      return EXIT.USAGE;
    }
    if (e instanceof CliError) {
      process.stderr.write(`relay: ${e.message}\n`);
      return e.exitCode;
    }
    process.stderr.write(
      `relay: unexpected error: ${e instanceof Error ? e.message : String(e)}\n`,
    );
    return EXIT.UNEXPECTED;
  }
}

export { buildProgram } from "./program.js";
export { introspect } from "./introspect.js";
