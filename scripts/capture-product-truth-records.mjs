// Converts product-truth/{releases,decisions}/*.yaml (the human-authored
// records) into fixtures/{releases,decisions}.json for the Worker's T4/T5
// resolvers, which import JSON at build time. CI regenerates and diffs, so
// the fixtures cannot drift from the YAML (same pattern as the CLI fixture).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function capture(kind) {
  const dir = join(root, "product-truth", kind);
  const records = readdirSync(dir)
    .filter((f) => f.endsWith(".yaml"))
    .sort()
    .map((file) => ({ source_file: `product-truth/${kind}/${file}`, ...parse(readFileSync(join(dir, file), "utf8")) }));
  writeFileSync(
    join(root, "fixtures", `${kind}.json`),
    `${JSON.stringify({ [kind]: records }, null, 2)}\n`,
  );
  return records.length;
}

console.log(`captured ${capture("releases")} releases, ${capture("decisions")} decisions`);
