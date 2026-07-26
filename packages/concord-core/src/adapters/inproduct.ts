import { CopyEntrySchema, type CopyEntry } from "@relay/contracts";
import { z } from "zod";
import { sha256Hex } from "../hash.js";
import type { DocUnit, FileDiff, SurfaceAdapter } from "../types.js";
import { makeDiff } from "../diff.js";

/**
 * In-product copy adapter: the copy registry is a documentation surface —
 * one DocUnit per entry. Input files are the registry JSONs (either read
 * from the estate or reconstructed from GET /api/copy-registry); ids are
 * estate-relative: `inproduct:in-product-copy/errors.json#error.upload.too_large`.
 */

const FileShape = z.object({ entries: z.array(CopyEntrySchema) });

const REGISTER_MAP: Record<CopyEntry["editorial_register"], DocUnit["editorial_register"]> = {
  terse_ui: "terse_ui",
  friendly_help: "friendly_help",
  technical_reference: "technical_reference",
};

export const inproductAdapter: SurfaceAdapter = {
  surface: "inproduct",
  ownedGlobs: ["in-product-copy/*.json"],

  parse(files): DocUnit[] {
    const units: DocUnit[] = [];
    for (const file of files) {
      if (file.path.startsWith("estate/")) {
        throw new Error(
          `mount prefix in adapter input: ${file.path} — ids must be estate-relative (I15)`,
        );
      }
      if (!file.path.endsWith(".json")) continue;
      const { entries } = FileShape.parse(JSON.parse(file.content));
      for (const entry of entries) {
        units.push({
          id: `inproduct:${file.path}#${entry.id}`,
          surface: "inproduct",
          path: file.path,
          anchor: entry.id,
          title: entry.id,
          body: entry.text,
          body_sha256: sha256Hex(entry.text),
          audience: "end_user",
          editorial_register: REGISTER_MAP[entry.editorial_register],
          owner: entry.owner,
          generated: false,
          frontmatter: {
            kind: entry.kind,
            surface_location: entry.surface_location,
            references_facts: entry.references_facts,
            interpolations: entry.interpolations,
          },
        });
      }
    }
    return units;
  },

  patch(unit, newBody): FileDiff {
    if (unit.generated) {
      throw new Error(
        `patch() refused: ${unit.id} is generated (constraints.md G8)`,
      );
    }
    // The registry file is JSON: the diff swaps this entry's `text` value.
    return makeDiff(unit.path, unit.body, newBody);
  },
};
