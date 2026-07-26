import {
  FACT_MUTATION_ALLOWLIST,
  mutationAllowed,
  type AllowedMutation,
} from "@relay/contracts";

/**
 * Change-Lab mutation validation (security.md §4.1/§4.2, Phase 18).
 *  - fact_value: the NINE-key allowlist with closed value sets. A key not
 *    in the table is MUTATION_NOT_ALLOWED *before* value validation. No
 *    patterns, no wildcards, no free-text values.
 *  - doc_body: only ids in fixtures/changelab/editable-units.json (repo 1,
 *    so estate writes can never widen it), ≤ 8192 bytes, and the content
 *    filter below. MDX is executable — a body edit is untrusted CODE input.
 */

export type MutationVerdict =
  | { ok: true }
  | { ok: false; code: string; detail: string };

const MAX_BODY_BYTES = 8192;

/** JSX components the docs actually use — everything else is rejected. */
const JSX_TAG_ALLOWLIST = new Set(["Note", "Warning", "Info", "Tip"]);

const FORBIDDEN_CONTENT: readonly { name: string; test: (body: string) => boolean }[] = [
  { name: "script_tag", test: (b) => /<\s*script\b/i.test(b) },
  { name: "iframe_tag", test: (b) => /<\s*iframe\b/i.test(b) },
  { name: "object_tag", test: (b) => /<\s*object\b/i.test(b) },
  { name: "embed_tag", test: (b) => /<\s*embed\b/i.test(b) },
  { name: "event_handler_attr", test: (b) => /\bon[a-z]+\s*=/i.test(b) },
  { name: "javascript_uri", test: (b) => /javascript:/i.test(b) },
  { name: "mdx_expression_braces", test: (b) => /\{[^}]*\}/.test(b) },
  { name: "import_statement", test: (b) => /^\s*import\s/m.test(b) },
  { name: "export_statement", test: (b) => /^\s*export\s/m.test(b) },
  {
    name: "jsx_component_outside_allowlist",
    test: (b) =>
      [...b.matchAll(/<\s*([A-Z][A-Za-z0-9]*)\b/g)].some(
        (m) => !JSX_TAG_ALLOWLIST.has(m[1] as string),
      ),
  },
];

export function validateDocBody(body: string): MutationVerdict {
  if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      code: "MUTATION_BODY_TOO_LARGE",
      detail: `doc bodies are capped at ${MAX_BODY_BYTES} bytes`,
    };
  }
  for (const rule of FORBIDDEN_CONTENT) {
    if (rule.test(body)) {
      return {
        ok: false,
        code: "MUTATION_CONTENT_FORBIDDEN",
        detail: `forbidden content: ${rule.name} — MDX is executable and body edits are treated as code input`,
      };
    }
  }
  return { ok: true };
}

export function validateMutation(
  mutation: AllowedMutation,
  editableDocUnitIds: readonly string[],
): MutationVerdict {
  if (mutation.kind === "fact_value") {
    // Key membership FIRST — an off-allowlist key never reaches value checks.
    if (!(mutation.fact_key in FACT_MUTATION_ALLOWLIST)) {
      return {
        ok: false,
        code: "MUTATION_NOT_ALLOWED",
        detail: `${mutation.fact_key} is not in the nine-key mutation allowlist`,
      };
    }
    if (!mutationAllowed(mutation.fact_key, mutation.value)) {
      return {
        ok: false,
        code: "MUTATION_VALUE_NOT_ALLOWED",
        detail: `${JSON.stringify(mutation.value)} is not in the closed value set for ${mutation.fact_key}`,
      };
    }
    return { ok: true };
  }
  // doc_body
  if (!editableDocUnitIds.includes(mutation.doc_unit_id)) {
    return {
      ok: false,
      code: "MUTATION_NOT_ALLOWED",
      detail: `${mutation.doc_unit_id} is not in fixtures/changelab/editable-units.json`,
    };
  }
  return validateDocBody(mutation.body);
}
