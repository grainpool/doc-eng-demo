// Captures `relay introspect --json` into fixtures/cli-introspection.json.
// generated_at is pinned to a constant so the committed fixture is
// byte-deterministic — CI regenerates it and fails on any diff (staleness
// check). The live timestamp still appears when users run introspect.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = execFileSync(
  process.execPath,
  [join(root, "packages", "relay-cli", "dist", "bin.js"), "introspect", "--json"],
  { encoding: "utf8" },
);
const data = JSON.parse(raw);
data.generated_at = "1970-01-01T00:00:00.000Z"; // fixture pin, not a lie about freshness
writeFileSync(
  join(root, "fixtures", "cli-introspection.json"),
  `${JSON.stringify(data, null, 2)}\n`,
);
console.log(`captured ${data.commands.length} commands`);
