import { Hono } from "hono";
import { z } from "zod";
import { CopyEntrySchema, type CopyEntry } from "@relay/contracts";
import errors from "../../../../estate/in-product-copy/errors.json";
import projects from "../../../../estate/in-product-copy/projects.json";
import files from "../../../../estate/in-product-copy/files.json";
import health from "../../../../estate/in-product-copy/health.json";
import sessions from "../../../../estate/in-product-copy/sessions.json";
import artifacts from "../../../../estate/in-product-copy/artifacts.json";
import settings from "../../../../estate/in-product-copy/settings.json";
import type { Env } from "../env.js";

/**
 * GET /api/copy-registry (contracts.md §8, §10) — the second and LAST
 * endpoint Concord is permitted to call. Entries come from the estate
 * submodule at build time and are schema-validated once at module init:
 * a malformed entry fails the build, not a runtime consumer.
 */
const ENTRIES: CopyEntry[] = z.array(CopyEntrySchema).parse([
  ...errors.entries,
  ...projects.entries,
  ...files.entries,
  ...health.entries,
  ...sessions.entries,
  ...artifacts.entries,
  ...settings.entries,
]);

export const copyRegistry = new Hono<{ Bindings: Env }>();

copyRegistry.get("/copy-registry", (c) => c.json({ entries: ENTRIES }));

export { ENTRIES as COPY_ENTRIES };
