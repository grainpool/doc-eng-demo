import { factValue, marker, type Generator } from "./types.js";

/** Plan-gating table — `generated/plan-gating.mdx`, from plan.feature.*. */
export const planGatingGenerator: Generator = {
  id: "plan-gating",
  generate(facts) {
    const features = [
      ...new Set(
        facts
          .map((f) => /^plan\.feature\.([a-z0-9_]+)\.min_plan$/.exec(f.key)?.[1])
          .filter((x): x is string => x !== undefined),
      ),
    ].sort();
    const rows = features.map(
      (feature) =>
        `| ${feature} | ${String(factValue(facts, `plan.feature.${feature}.min_plan`))} |`,
    );
    const content = `---
title: "Plan gating"
generated: true
owner: "concord"
---

${marker("plan.feature.*.min_plan")}

Which plan a feature first becomes available on. Plans are cumulative:
a feature available on \`free\` is available on every plan above it.

| feature | minimum plan |
|---|---|
${rows.join("\n")}
`;
    return [{ path: "docs-mintlify/generated/plan-gating.mdx", content }];
  },
};
