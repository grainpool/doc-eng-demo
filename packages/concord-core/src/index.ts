export {
  DocUnitSchema,
  FileDiffSchema,
  FactProjectionSchema,
  FindingSchema,
  ImpactSchema,
  type DocUnit,
  type FileDiff,
  type FactProjection,
  type FactDelta,
  type Finding,
  type Impact,
  type SurfaceAdapter,
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
  authorityConflictFindings,
} from "./consistency.js";
export { classify, type Classification } from "./classify.js";
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
export { makeDiff } from "./diff.js";
export { sha256Hex } from "./hash.js";
