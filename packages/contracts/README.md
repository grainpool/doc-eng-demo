# @relay/contracts

The freeze surface: Zod schemas, enums, error codes, and the model constant shared by every other
package. Depends on `zod` and nothing else (constraints.md G3).

Phase 01 contents: `MODEL_ID`, the closed `ErrorCode` enum, and the single API error shape.
The fact-key registry, id helpers, operation schemas, and product config land in Phase 02.
