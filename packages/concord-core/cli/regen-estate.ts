/**
 * `pnpm regen:estate` — write every generator's output into the mounted
 * estate working tree. This is the ONLY sanctioned way generated estate
 * files change (G8: regenerated, never hand-patched). Pure generation
 * happens in src/generators; this shell does the I/O.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CliIntrospectionSchema } from "@relay/contracts";
import { generateAll } from "../src/generators/index.js";
import { readEstate } from "./ingest.js";
import { generatorFacts } from "./generator-facts.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function main(): void {
  const cli = CliIntrospectionSchema.parse(
    JSON.parse(readFileSync(join(root, "fixtures", "cli-introspection.json"), "utf8")),
  );
  const outputs = generateAll(generatorFacts(), { cli, files: readEstate() });
  for (const output of outputs) {
    const target = join(root, "estate", output.path);
    mkdirSync(dirname(target), { recursive: true });
    const existing = ((): string | null => {
      try {
        return readFileSync(target, "utf8");
      } catch {
        return null;
      }
    })();
    if (existing === output.content) {
      console.log(`  unchanged ${output.path}`);
      continue;
    }
    writeFileSync(target, output.content, "utf8");
    console.log(`  ${existing === null ? "created  " : "rewrote  "} ${output.path}`);
  }
}

main();
