/**
 * The terminal's command GRAMMAR is the CLI introspection fixture — the same
 * CI-gated artifact the docs generators read (T2 authority, invariant I3).
 * Nothing here declares a command, a flag, or a usage string of its own
 * (anti-pattern AP-E2): this module only indexes the fixture for lookup.
 */
import introspection from "../../../../fixtures/cli-introspection.json";

export interface FixtureFlag {
  name: string;
  alias: string | null;
  type: string;
  required: boolean;
  default: unknown;
  description: string;
}

export interface FixtureCommand {
  path: string;
  summary: string;
  usage: string;
  flags: FixtureFlag[];
  examples: string[];
}

const COMMANDS: FixtureCommand[] = (
  introspection as { commands: FixtureCommand[] }
).commands.filter((c) => c.path !== "relay"); // the root entry is not invokable

const BY_PATH = new Map(COMMANDS.map((c) => [c.path, c]));

export function commandAt(path: string): FixtureCommand | undefined {
  return BY_PATH.get(path);
}

export function allCommands(): FixtureCommand[] {
  return COMMANDS;
}

/** Longest-prefix match of input tokens against fixture command paths. */
export function matchCommand(
  tokens: string[],
): { command: FixtureCommand; rest: string[] } | null {
  for (let take = Math.min(tokens.length, 3); take >= 1; take--) {
    const candidate = tokens.slice(0, take).join(" ");
    const command = BY_PATH.get(candidate);
    if (command) return { command, rest: tokens.slice(take) };
  }
  return null;
}

/** Nearest-match suggestion for an unknown first token. */
export function suggestCommand(word: string): string | null {
  const roots = [...new Set(COMMANDS.map((c) => c.path.split(" ")[0] as string))];
  const scored = roots
    .map((root) => ({ root, score: sharedPrefix(word, root) }))
    .sort((a, b) => b.score - a.score);
  const best = scored[0];
  return best && best.score >= 2 ? best.root : null;
}

function sharedPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
