import { z } from "zod";

/**
 * The formal copy registry entry (contracts.md §8). Copy is a documentation
 * surface: `references_facts` is what makes a UI string reconcilable — an
 * entry stating a number MUST declare the fact key it asserts (the known
 * exceptions are the Phase-08 UNDECLARED_FACT_REF eval seeds, listed by id
 * in fixtures/eval/defects.json).
 */
export const COPY_KINDS = [
  "tooltip",
  "empty_state",
  "onboarding",
  "error",
  "validation",
  "setting_description",
  "feature_availability",
  "label",
] as const;

export const EDITORIAL_REGISTERS = [
  "terse_ui",
  "friendly_help",
  "technical_reference",
] as const;

export const CopyEntrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(COPY_KINDS),
  text: z.string().min(1),
  surface_location: z.string().min(1),
  references_facts: z.array(z.string()),
  owner: z.string().min(1),
  editorial_register: z.enum(EDITORIAL_REGISTERS),
  interpolations: z.array(z.string()).default([]),
});
export type CopyEntry = z.infer<typeof CopyEntrySchema>;
