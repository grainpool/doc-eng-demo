export {
  DocUnitSchema,
  FileDiffSchema,
  FactProjectionSchema,
  ImpactSchema,
  type DocUnit,
  type FileDiff,
  type FactProjection,
  type FactDelta,
  type Impact,
  type SurfaceAdapter,
} from "./types.js";
export { mintlifyAdapter, slugify } from "./adapters/mintlify.js";
export { inproductAdapter } from "./adapters/inproduct.js";
export { extractDeclaredReferences } from "./extract.js";
export { classify, type Classification } from "./classify.js";
export { detectDeltas, runPipeline, type PipelineInput, type PipelineOutput } from "./pipeline.js";
export { parseValue, formatValue, styleOf, sameValue } from "./normalize-value.js";
export { makeDiff } from "./diff.js";
export { sha256Hex } from "./hash.js";
