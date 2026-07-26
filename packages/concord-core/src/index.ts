export {
  DocUnitSchema,
  FileDiffSchema,
  FactProjectionSchema,
  FindingSchema,
  ImpactSchema,
  WarningSchema,
  type DocUnit,
  type FileDiff,
  type FactProjection,
  type FactDelta,
  type Finding,
  type Impact,
  type SurfaceAdapter,
  type Warning,
} from "./types.js";
export { mintlifyAdapter, slugify } from "./adapters/mintlify.js";
export { inproductAdapter } from "./adapters/inproduct.js";
export { helpcenterAdapter } from "./adapters/helpcenter.js";
export {
  clidocsAdapter,
  releaseAdapter,
  generatedAdapter,
} from "./adapters/generated-like.js";
export { ADAPTERS, filesFor, globToRegExp, parseEstate } from "./select.js";
export { extractDeclaredReferences } from "./extract.js";
export {
  extractFrontmatterFields,
  extractGeneratedMarkers,
  extractAvailabilityTables,
  extractTermOccurrences,
  extractNumericPatterns,
  termSpecsFromFacts,
  normalizeProjections,
  dedupeProjections,
  runExtractors,
  unitsNeedingModelExtraction,
  type ExtractionOutput,
  type ExtractionRefusal,
} from "./extractors.js";
export {
  detectConflicts,
  circularReferences,
  insufficientEvidenceConflict,
} from "./conflicts.js";
export {
  needsFalsification,
  proposalForFinding,
  FALSIFIER_SYSTEM_PROMPT,
  FALSIFIER_OUTPUT_SCHEMA,
  buildFalsifierPrompt,
  parseFalsifierResponse,
  type Proposal,
  type FalsifierVerdict,
} from "./falsify.js";
export {
  pathAllowlisted,
  bodyContentSafe,
  validatePatch,
  type PatchVerdict,
  type ValidatePatchInput,
} from "./patch-validate.js";
export {
  PATCH_SYSTEM_PROMPT,
  EDITORIAL_SYSTEM_PROMPT,
  PATCH_PROPOSAL_OUTPUT_SCHEMA,
  buildPatchUserPrompt,
  evidenceFromDelta,
  parsePatchProposal,
} from "./patch-prompts.js";
export {
  MODEL_EXTRACTION_CONFIDENCE_CAP,
  MODEL_EXTRACTION_SCHEMA,
  buildModelExtractionPrompt,
  parseModelExtraction,
} from "./model-extract.js";
export {
  expandClaims,
  arbitrate,
  arbitrateAll,
  ownerOfFact,
  type TierClaim,
  type Arbitration,
  type AuthorityConflict,
} from "./authority.js";
export {
  consistencyFindings,
  undocumentedFactFindings,
  undeclaredReferenceFindings,
  authorityConflictFindings,
} from "./consistency.js";
export {
  classify,
  dispositionFor,
  type Classification,
  type ClassifyContext,
} from "./classify.js";
export {
  GENERATORS,
  generateAll,
  runGenerators,
  type GeneratorRunOutput,
} from "./generators/index.js";
export type {
  Generator,
  GeneratorInputs,
  GeneratedFile,
} from "./generators/types.js";
export { detectDeltas, runPipeline, type PipelineInput, type PipelineOutput } from "./pipeline.js";
export {
  parseValue,
  parseDuration,
  parseAvailability,
  parsePlan,
  normalizeForFact,
  unitOfFactKey,
  formatValue,
  styleOf,
  sameValue,
  sameNormalized,
  type Normalized,
  type FactUnit,
} from "./normalize-value.js";
export {
  validateMutation,
  validateDocBody,
  type MutationVerdict,
} from "./mutation-validate.js";
export { checkInternalLinks } from "./linkcheck.js";
export { makeDiff } from "./diff.js";
export { sha256Hex } from "./hash.js";
