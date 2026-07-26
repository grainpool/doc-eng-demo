// Phase 17 — record the five ChangeLabRun fixtures by RUNNING THE REAL
// PIPELINE live and committing the output verbatim (never hand-authored).
// Sequence: for each scenario, deploy the baseline value, run (ingest),
// deploy the target value, run with the AI paths on, capture ?verbose=1.
// Ends with every fact back at its default and the estate untouched.
//
// Operator script (repo 1, local only): drives wrangler + the admin route,
// which is enabled for the recording session via --var DEMO_ADMIN_ENABLED:1.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const API = "https://concord-api.trejootoniel.workers.dev";
const LIMITS = join(root, "packages", "relay-api", "src", "limits.ts");
const CONFIG = join(root, "packages", "contracts", "src", "product-config.ts");

function edit(file, from, to) {
  const content = readFileSync(file, "utf8");
  if (!content.includes(from)) throw new Error(`edit failed: ${from} not in ${file}`);
  writeFileSync(file, content.replace(from, to));
}

function deployRelay() {
  execSync("pnpm run build", { cwd: join(root, "packages", "relay-web"), stdio: "pipe" });
  execSync("npx wrangler deploy --config dist/relay_api/wrangler.json", {
    cwd: join(root, "packages", "relay-web"),
    stdio: "pipe",
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runAndWait(ai) {
  const path = ai ? "/api/admin/runs" : "/api/runs";
  const res = await fetch(`${API}${path}`, { method: "POST" });
  const { run_id } = await res.json();
  for (let i = 0; i < 80; i += 1) {
    await sleep(5000);
    const check = await (await fetch(`${API}/api/public/runs/${run_id}`)).json();
    if (["completed", "failed", "partial"].includes(check.run?.status)) {
      return { run_id, status: check.run.status };
    }
  }
  throw new Error(`run ${run_id} did not finish`);
}

const SCENARIOS = [
  {
    name: "term-rename-job-to-task",
    baseline: () => edit(CONFIG, 'task: "Task",', 'task: "Job",'),
    target: () => edit(CONFIG, 'task: "Job",', 'task: "Task",'),
    mutation: { kind: "fact_value", fact_key: "term.canonical.task", value: "Task" },
    cleanup: null,
  },
  {
    name: "limit-increase-10-to-25mb",
    baseline: null, // live default 10 MB IS the baseline
    target: () => edit(LIMITS, "= 10_485_760; // 10 MB", "= 26_214_400; // 25 MB (recording)"),
    mutation: { kind: "fact_value", fact_key: "limit.upload.csv.max_bytes", value: 26214400 },
    cleanup: () => edit(LIMITS, "= 26_214_400; // 25 MB (recording)", "= 10_485_760; // 10 MB"),
  },
  {
    name: "platform-enablement-ios",
    baseline: null,
    target: () => edit(CONFIG, "ios: false,", "ios: true,"),
    mutation: {
      kind: "fact_value",
      fact_key: "availability.feature.analysis_sessions.platform.ios",
      value: true,
    },
    cleanup: () => edit(CONFIG, "ios: true,", "ios: false,"),
  },
  {
    name: "retention-change-30-to-90",
    baseline: null,
    target: () => edit(CONFIG, "artifact_days: 30,", "artifact_days: 90,"),
    mutation: { kind: "fact_value", fact_key: "retention.artifact.days", value: 90 },
    cleanup: () => edit(CONFIG, "artifact_days: 90,", "artifact_days: 30,"),
  },
  {
    name: "capability-addition-regression",
    baseline: () =>
      edit(CONFIG, "analysis_regression_enabled: true,", "analysis_regression_enabled: false,"),
    target: () =>
      edit(CONFIG, "analysis_regression_enabled: false,", "analysis_regression_enabled: true,"),
    mutation: { kind: "fact_value", fact_key: "flag.analysis.regression_enabled", value: true },
    cleanup: null,
  },
];

mkdirSync(join(root, "fixtures", "runs"), { recursive: true });

for (const scenario of SCENARIOS) {
  console.log(`## ${scenario.name}`);
  if (scenario.baseline) {
    scenario.baseline();
    deployRelay();
    await sleep(100_000);
    const ingest = await runAndWait(false); // ingest leg: deterministic, discard
    console.log(`  baseline ingested (${ingest.run_id} ${ingest.status})`);
  }
  scenario.target();
  deployRelay();
  await sleep(100_000);
  const recorded = await runAndWait(true); // the REAL run, AI paths on
  console.log(`  recorded run ${recorded.run_id} (${recorded.status})`);
  const verbose = await (
    await fetch(`${API}/api/public/runs/${recorded.run_id}?verbose=1`)
  ).json();
  if (!verbose.run_id) throw new Error(`verbose failed for ${recorded.run_id}`);
  verbose.mutation = scenario.mutation; // the driving mutation, explicit
  writeFileSync(
    join(root, "fixtures", "runs", `${scenario.name}.json`),
    `${JSON.stringify(verbose, null, 1)}\n`,
  );
  console.log(`  saved fixtures/runs/${scenario.name}.json (impacts ${verbose.impacts.length}, patches ${verbose.patches.length}, conflicts ${verbose.conflicts.length}, $${verbose.model_usage.estimated_usd})`);
  if (scenario.cleanup) {
    scenario.cleanup();
    deployRelay();
    await sleep(100_000);
    const settle = await runAndWait(false);
    console.log(`  reverted + settled (${settle.run_id} ${settle.status})`);
  }
}
console.log("DONE — all five recordings captured; defaults restored.");
