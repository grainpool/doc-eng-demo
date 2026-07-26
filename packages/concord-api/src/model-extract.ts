import Anthropic from "@anthropic-ai/sdk";
import { MODEL_ID } from "@relay/contracts";
import {
  MODEL_EXTRACTION_SCHEMA,
  buildModelExtractionPrompt,
  parseModelExtraction,
  type DocUnit,
  type FactProjection,
} from "@concord/core";

/**
 * The network half of model_extraction: structured output, refusal checked
 * BEFORE content (G11), no temperature/top_p/top_k/budget_tokens (G13),
 * fan-out batched at ≤ 5 concurrent (G9). Prompt text is never logged —
 * only unit ids and counts reach run_step.
 */

const MAX_CONCURRENT = 5;

export interface ModelExtractionResult {
  projections: FactProjection[];
  attempted: number;
  refused: number;
  failed: number;
  /** First failure's message (truncated) — never prompt text, for run_step. */
  first_error: string | null;
}

type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

async function extractOne(
  client: Anthropic,
  unit: DocUnit,
  detectedAt: string,
): Promise<{ projections: FactProjection[]; refused: boolean; usage: Usage }> {
  const { system, user } = buildModelExtractionPrompt(unit);
  // No temperature/top_p/top_k/budget_tokens — rejected by this model (G13).
  const message = await client.messages.create({
    model: MODEL_ID,
    max_tokens: 2048,
    thinking: { type: "adaptive" },
    output_config: {
      format: {
        type: "json_schema",
        schema: MODEL_EXTRACTION_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    // The system prompt is the stable prefix — cache it; the unit body and
    // everything volatile is strictly after the breakpoint.
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });
  // stop_reason is checked BEFORE content is read, on every call (G11).
  if (message.stop_reason === "refusal") {
    return { projections: [], refused: true, usage: message.usage };
  }
  const text = message.content.find(
    (block): block is { type: "text"; text: string; citations: null } =>
      block.type === "text",
  )?.text;
  if (!text) return { projections: [], refused: false, usage: message.usage };
  return {
    projections: parseModelExtraction(unit, detectedAt, text),
    refused: false,
    usage: message.usage,
  };
}

export async function runModelExtraction(
  apiKey: string,
  units: DocUnit[],
  detectedAt: string,
  /** Spend attribution (Phase 14): called once per completed call. */
  onUsage?: (usage: Usage) => Promise<void>,
): Promise<ModelExtractionResult> {
  const client = new Anthropic({ apiKey });
  const result: ModelExtractionResult = {
    projections: [],
    attempted: units.length,
    refused: 0,
    failed: 0,
    first_error: null,
  };
  for (let i = 0; i < units.length; i += MAX_CONCURRENT) {
    const batch = units.slice(i, i + MAX_CONCURRENT);
    const settled = await Promise.allSettled(
      batch.map((unit) => extractOne(client, unit, detectedAt)),
    );
    for (const outcome of settled) {
      if (outcome.status === "rejected") {
        result.failed += 1;
        if (result.first_error === null) {
          const reason = outcome.reason;
          result.first_error =
            reason instanceof Error ? reason.message.slice(0, 300) : String(reason).slice(0, 300);
        }
        continue;
      }
      if (onUsage) await onUsage(outcome.value.usage);
      if (outcome.value.refused) result.refused += 1;
      result.projections.push(...outcome.value.projections);
    }
  }
  return result;
}
