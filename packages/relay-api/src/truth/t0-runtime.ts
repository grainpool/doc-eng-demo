import { OPERATION_IDS } from "@relay/contracts";
import type { FactClaim } from "@relay/contracts";
import { containerKernel } from "../kernel/container-kernel.js";
import type { Env } from "../env.js";
import type { TierResolution, TierResolver } from "./types.js";

/**
 * T0_RUNTIME: read from the RUNNING kernel at request time — /versions and
 * /operations — never from requirements.txt or any committed file. This is
 * the tier that proves runtime state can be authoritative. The locator is
 * the kernel image digest: the claim is anchored to the exact image that
 * reported it.
 *
 * Versions in FACT_REGISTRY: python, pandas, scipy, statsmodels, matplotlib.
 * (numpy/fastapi are reported by /versions but have no registered fact key —
 * only registered keys become claims.)
 */
const VERSION_FACT_PACKAGES = ["pandas", "scipy", "statsmodels", "matplotlib"] as const;

const OP_ID_SET: ReadonlySet<string> = new Set(OPERATION_IDS);

export const t0Runtime: TierResolver = {
  tier: "T0_RUNTIME",
  async resolve(env: Env): Promise<TierResolution> {
    const kernel = containerKernel(env);
    if (!kernel) {
      return { status: "pending", claims: [] };
    }
    try {
      const [versions, catalog] = await Promise.all([
        kernel.versions(),
        kernel.operations(),
      ]);
      const observedAt = new Date().toISOString();
      const locator = (anchor: string): string =>
        `kernel-image:${versions.image_digest}#${anchor}`;

      const claims: FactClaim[] = [
        {
          key: "runtime.python.version",
          value: versions.python,
          tier: "T0_RUNTIME",
          locator: locator("versions.python"),
          observed_at: observedAt,
          confidence: 1,
        },
        ...VERSION_FACT_PACKAGES.map(
          (pkg): FactClaim => ({
            key: `runtime.package.${pkg}.version`,
            value: versions[pkg],
            tier: "T0_RUNTIME",
            locator: locator(`versions.${pkg}`),
            observed_at: observedAt,
            confidence: 1,
          }),
        ),
        ...catalog
          .filter((op) => OP_ID_SET.has(op.id))
          .map(
            (op): FactClaim => ({
              key: `analysis.operation.${op.id}.enabled`,
              value: op.enabled,
              tier: "T0_RUNTIME",
              locator: locator(`operations.${op.id}.enabled`),
              observed_at: observedAt,
              confidence: 1,
            }),
          ),
      ];
      return { status: "ok", claims };
    } catch {
      // Kernel unreachable: the tier degrades to pending with zero claims —
      // never a fabricated value, never a 500 for the whole snapshot.
      return { status: "pending", claims: [] };
    }
  },
};
