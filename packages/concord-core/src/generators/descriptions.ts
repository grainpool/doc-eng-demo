import { factValue, type Generator } from "./types.js";

/**
 * Frontmatter `description` fields for pages whose description STATES A
 * FACT. Mintlify builds `llms.txt` from these descriptions (Phase 11), so
 * a stale description leaks a stale fact to agents. Concord never writes
 * `llms.txt` itself (G7) — it keeps the INPUTS truthful.
 *
 * These pages are NOT generated files: only the description value is owned
 * here. The templates are declarative and pure; the page body is untouched.
 */
const DESCRIPTION_TEMPLATES: Record<
  string,
  { source_facts: string[]; render(facts: Parameters<Generator["generate"]>[0]): string }
> = {
  "docs-mintlify/supported-files.mdx": {
    source_facts: ["limit.upload.csv.max_bytes"],
    render(facts) {
      const bytes = Number(factValue(facts, "limit.upload.csv.max_bytes"));
      return `Which file types Relay accepts and the ${bytes / 1_048_576} MB size limit that applies.`;
    },
  },
};

export const descriptionsGenerator: Generator = {
  id: "frontmatter-descriptions",
  generate(facts, inputs) {
    const out = [];
    for (const [path, template] of Object.entries(DESCRIPTION_TEMPLATES)) {
      const file = inputs.files.find((f) => f.path === path);
      if (!file) continue;
      const description = template.render(facts);
      const replaced = file.content.replace(
        /^description: ".*"$/m,
        `description: "${description}"`,
      );
      out.push({ path, content: replaced });
    }
    return out;
  },
};

/** Paths whose outputs are description-only patches of hand-authored pages
 * — exempt from hand-edit warnings (the body is SUPPOSED to be hand-edited). */
export const DESCRIPTION_ONLY_PATHS: ReadonlySet<string> = new Set(
  Object.keys(DESCRIPTION_TEMPLATES),
);
