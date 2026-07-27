/**
 * "What the system gets wrong" — generates concord-web/public/failures.html.
 * I/O wrapper only; the page itself renders in failures-page.ts (pure,
 * unit-tested). Inputs: eval-report.json (the measured misses) and
 * fixtures/decisions.json (production blind-spot observations, T5).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  renderFailuresPage,
  type DecisionRecord,
  type EvalReport,
} from "./failures-page.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const report = JSON.parse(
  readFileSync(join(root, "eval-report.json"), "utf8"),
) as EvalReport;
const decisions = (
  JSON.parse(readFileSync(join(root, "fixtures", "decisions.json"), "utf8")) as {
    decisions: DecisionRecord[];
  }
).decisions;

writeFileSync(
  join(root, "packages", "concord-web", "public", "failures.html"),
  renderFailuresPage(report, decisions),
);
console.log("failures.html generated");
