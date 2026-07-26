import { PLATFORMS } from "@relay/contracts";
import { factValue, marker, type Generator } from "./types.js";

/**
 * The platform × feature availability matrix plus the limits table —
 * `generated/availability-matrix.mdx`. Feature rows are derived from the
 * availability fact keys present in the snapshot; a platform a feature
 * makes no claim about renders as `—`.
 */
export const availabilityMatrixGenerator: Generator = {
  id: "availability-matrix",
  generate(facts) {
    const features = [
      ...new Set(
        facts
          .map((f) => /^availability\.feature\.([a-z0-9_]+)\.platform\./.exec(f.key)?.[1])
          .filter((x): x is string => x !== undefined),
      ),
    ].sort();
    const featureRows = features.map((feature) => {
      const cells = PLATFORMS.map((platform) => {
        const value = factValue(facts, `availability.feature.${feature}.platform.${platform}`);
        return value === undefined ? "—" : String(value);
      });
      return `| ${feature} | ${cells.join(" | ")} |`;
    });
    const maxBytes = factValue(facts, "limit.upload.csv.max_bytes");
    const maxRows = factValue(facts, "limit.upload.csv.max_rows");
    const content = `---
title: "Availability & limits matrix"
generated: true
owner: "concord"
---

${marker("availability.feature.*, limit.upload.csv.max_bytes, support.file_type.*")}

## Limits

{/* concord:fact key=limit.upload.csv.max_bytes */}
| fact | value |
|---|---|
| limit.upload.csv.max_bytes | ${maxBytes} |
| limit.upload.csv.max_rows | ${maxRows} |

## Feature availability

| feature | ${PLATFORMS.join(" | ")} |
|---|${PLATFORMS.map(() => "---|").join("")}
${featureRows.join("\n")}
`;
    return [{ path: "docs-mintlify/generated/availability-matrix.mdx", content }];
  },
};
