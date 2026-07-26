import type { FactClaim } from "@relay/contracts";
import { makeDiff } from "../diff.js";
import type { FileDiff, Warning } from "../types.js";
import { availabilityMatrixGenerator } from "./availability-matrix.js";
import { planGatingGenerator } from "./plan-gating.js";
import { cliReferenceGenerator } from "./cli-reference.js";
import { changelogGenerator } from "./changelog.js";
import { navigationGenerator } from "./navigation.js";
import { descriptionsGenerator, DESCRIPTION_ONLY_PATHS } from "./descriptions.js";
import type { GeneratedFile, Generator, GeneratorInputs } from "./types.js";

export const GENERATORS: readonly Generator[] = [
  availabilityMatrixGenerator,
  planGatingGenerator,
  cliReferenceGenerator,
  changelogGenerator,
  navigationGenerator,
  descriptionsGenerator,
];

export interface GeneratorRunOutput {
  /** Diffs that bring the estate to the generators' intended output. */
  diffs: FileDiff[];
  /** Hand-edit warnings — documented behavior: overwrite AND warn. */
  warnings: Warning[];
  /** Every path the generators own this run. */
  paths: string[];
}

/** G7: Concord never authors llms.txt — enforced mechanically, not by review. */
const FORBIDDEN_PATH = /(^|\/)llms(-full)?\.txt$/;

export function generateAll(
  facts: readonly FactClaim[],
  inputs: GeneratorInputs,
): GeneratedFile[] {
  const outputs = GENERATORS.flatMap((generator) => generator.generate(facts, inputs));
  for (const output of outputs) {
    if (FORBIDDEN_PATH.test(output.path)) {
      throw new Error(`G7 violation: a generator attempted to emit ${output.path}`);
    }
    if (output.path.startsWith("estate/")) {
      throw new Error(`mount prefix in generator output: ${output.path} (I15)`);
    }
  }
  return outputs;
}

/**
 * Diff generator output against the estate, with hand-edit detection:
 *  - file equals the CURRENT-facts output → up to date, no diff;
 *  - file equals the PREVIOUS-facts output → normal fact-driven regen;
 *  - file matches NEITHER → it was hand-edited: overwrite it and record a
 *    `generated_file_hand_edited` warning (documented behavior, not a bug).
 */
export function runGenerators(
  previousFacts: readonly FactClaim[],
  currentFacts: readonly FactClaim[],
  inputs: GeneratorInputs,
): GeneratorRunOutput {
  const current = generateAll(currentFacts, inputs);
  const previous = new Map(
    generateAll(previousFacts, inputs).map((f) => [f.path, f.content]),
  );
  const existingByPath = new Map(inputs.files.map((f) => [f.path, f.content]));
  const diffs: FileDiff[] = [];
  const warnings: Warning[] = [];
  for (const output of current) {
    const existing = existingByPath.get(output.path);
    if (existing === output.content) continue;
    if (
      existing !== undefined &&
      existing !== previous.get(output.path) &&
      !DESCRIPTION_ONLY_PATHS.has(output.path)
    ) {
      warnings.push({
        kind: "generated_file_hand_edited",
        path: output.path,
        detail:
          `${output.path} matches its generator's output for neither the current ` +
          `nor the previous snapshot — hand-edited, or a pending regen was never ` +
          `applied. Overwriting; generated files are regenerated, never ` +
          `hand-patched (G8).`,
      });
    }
    diffs.push(makeDiff(output.path, existing ?? "", output.content));
  }
  return { diffs, warnings, paths: current.map((f) => f.path) };
}
