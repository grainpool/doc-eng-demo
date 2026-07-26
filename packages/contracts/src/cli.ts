import { z } from "zod";

/**
 * `relay introspect --json` — the T2_CLI authority source (contracts.md
 * §7.1). Derived by walking the live commander tree at runtime; a
 * hand-written manifest is forbidden (AP9).
 */
export const CliIntrospectionSchema = z.object({
  cli_version: z.string(),
  generated_at: z.string(),
  commands: z.array(
    z.object({
      path: z.string(), // "projects list"
      summary: z.string(),
      usage: z.string(), // exactly what --help prints
      flags: z.array(
        z.object({
          name: z.string(),
          alias: z.string().nullable(),
          type: z.string(),
          required: z.boolean(),
          default: z.unknown().nullable(),
          description: z.string(),
        }),
      ),
      exit_codes: z.array(z.object({ code: z.number(), meaning: z.string() })),
      examples: z.array(z.string()),
    }),
  ),
});
export type CliIntrospection = z.infer<typeof CliIntrospectionSchema>;

/** Contractual exit codes (contracts.md §7). */
export const CLI_EXIT_CODES = [
  { code: 0, meaning: "ok" },
  { code: 1, meaning: "unexpected error" },
  { code: 2, meaning: "usage error" },
  { code: 3, meaning: "auth failure" },
  { code: 4, meaning: "not found" },
  { code: 5, meaning: "validation failure" },
  { code: 6, meaning: "remote unavailable" },
] as const;
