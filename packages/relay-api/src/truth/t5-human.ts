import type { FactClaim } from "@relay/contracts";
import decisionsFixture from "../../../../fixtures/decisions.json";
import type { TierResolution, TierResolver } from "./types.js";

/**
 * T5_HUMAN — decision records. A decision claims fact keys only where its
 * record explicitly lists them (`claims_fact_keys`); the claim key itself is
 * always the decision's own `decision.<id>.record`.
 */
interface DecisionRecord {
  source_file: string;
  id: string;
  decided_at: string;
  decided_by: string;
  kind: string;
  claims_fact_keys: string[];
  statement: string;
}

const DECISIONS = (decisionsFixture as { decisions: DecisionRecord[] }).decisions;

export const t5Human: TierResolver = {
  tier: "T5_HUMAN",
  resolve(): Promise<TierResolution> {
    const observedAt = new Date().toISOString();
    const claims: FactClaim[] = DECISIONS.map((decision) => ({
      key: `decision.${decision.id.replace(/^dec_/, "")}.record`,
      value: {
        decided_at: decision.decided_at,
        decided_by: decision.decided_by,
        kind: decision.kind,
        claims_fact_keys: decision.claims_fact_keys,
        statement: decision.statement,
      },
      tier: "T5_HUMAN" as const,
      locator: `${decision.source_file}#statement`,
      observed_at: observedAt,
      confidence: 1,
    }));
    return Promise.resolve({ status: "ok", claims });
  },
};
