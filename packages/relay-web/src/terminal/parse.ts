import { matchCommand, suggestCommand, type FixtureCommand } from "./grammar.js";

/**
 * Input parsing for the browser terminal: tokenize (double quotes group
 * words), resolve the command against the fixture grammar, then parse flags
 * against THAT command's fixture flag specs. No evaluation of any kind —
 * a line of input only ever becomes data routed to a typed binding.
 */

export type Parsed =
  | { kind: "empty" }
  | { kind: "local"; name: string; args: string[] }
  | { kind: "unknown"; word: string; suggestion: string | null }
  | {
      kind: "run";
      command: FixtureCommand;
      positionals: string[];
      flags: Record<string, string | boolean>;
      flagError: string | null;
    };

export const LOCAL_COMMANDS = ["help", "clear", "history"] as const;

export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    tokens.push(match[1] !== undefined ? match[1] : (match[2] as string));
  }
  return tokens;
}

export function parseLine(line: string): Parsed {
  const tokens = tokenize(line.trim());
  const first = tokens[0];
  if (!first) return { kind: "empty" };

  if ((LOCAL_COMMANDS as readonly string[]).includes(first)) {
    return { kind: "local", name: first, args: tokens.slice(1) };
  }
  // `relay projects list` and `projects list` both work: the CLI binary name
  // is noise in a terminal that only speaks relay.
  const withoutBinary = first === "relay" ? tokens.slice(1) : tokens;
  if (withoutBinary.length === 0) return { kind: "empty" };

  const matched = matchCommand(withoutBinary);
  if (!matched) {
    const word = withoutBinary[0] as string;
    return { kind: "unknown", word, suggestion: suggestCommand(word) };
  }

  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let flagError: string | null = null;
  const specs = new Map(matched.command.flags.map((f) => [f.name, f]));

  for (let i = 0; i < matched.rest.length; i++) {
    const token = matched.rest[i] as string;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const spec = specs.get(name);
    if (!spec) {
      flagError = name;
      continue;
    }
    if (spec.type === "boolean") {
      flags[name] = true;
    } else if (eq !== -1) {
      flags[name] = token.slice(eq + 1);
    } else {
      const value = matched.rest[i + 1];
      if (value === undefined || value.startsWith("--")) {
        flagError = name;
      } else {
        flags[name] = value;
        i++;
      }
    }
  }
  return { kind: "run", command: matched.command, positionals, flags, flagError };
}
