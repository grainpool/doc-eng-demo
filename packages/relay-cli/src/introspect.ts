import type { Command, Option } from "commander";
import { CLI_EXIT_CODES, type CliIntrospection } from "@relay/contracts";
import { CLI_VERSION, examplesOf } from "./program.js";

/**
 * The T2_CLI authority source (contracts.md §7.1): derived by WALKING the
 * live commander tree — command paths, summaries, the exact `--help` text,
 * flags, exit codes, examples. There is no hand-maintained manifest (AP9);
 * if this could drift from `--help`, the claim that the CLI is authoritative
 * for mechanical facts would be false. Invariant I3 (usage === --help) is
 * asserted for every command by introspect-parity.test.ts.
 */

function flagType(option: Option): string {
  if (option.isBoolean()) return "boolean";
  return option.variadic ? "string[]" : "string";
}

function flagsOf(cmd: Command): CliIntrospection["commands"][number]["flags"] {
  return cmd.options.map((option) => ({
    name: option.long ?? option.name(),
    alias: option.short ?? null,
    type: flagType(option),
    required: option.mandatory,
    default: (option.defaultValue as unknown) ?? null,
    description: option.description,
  }));
}

/**
 * Exactly what `--help` prints — captured through commander's own
 * outputHelp(), which includes addHelpText sections (helpInformation()
 * alone omits them and would break invariant I3).
 */
function fullHelp(cmd: Command): string {
  let captured = "";
  const previous = cmd.configureOutput();
  cmd.configureOutput({
    writeOut: (s) => {
      captured += s;
    },
    writeErr: (s) => {
      captured += s;
    },
  });
  cmd.outputHelp();
  cmd.configureOutput(previous);
  return captured;
}

function walk(
  cmd: Command,
  path: string[],
  out: CliIntrospection["commands"],
): void {
  out.push({
    path: path.join(" ") || "relay",
    summary: cmd.summary() || cmd.description(),
    usage: fullHelp(cmd),
    flags: flagsOf(cmd),
    exit_codes: [...CLI_EXIT_CODES],
    examples: examplesOf(cmd),
  });
  for (const sub of cmd.commands) {
    walk(sub as Command, [...path, sub.name()], out);
  }
}

export function introspect(program: Command): CliIntrospection {
  const commands: CliIntrospection["commands"] = [];
  walk(program, [], commands);
  return {
    cli_version: CLI_VERSION,
    generated_at: new Date().toISOString(),
    commands,
  };
}
