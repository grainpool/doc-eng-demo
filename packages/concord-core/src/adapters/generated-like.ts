import matter from "gray-matter";
import { sha256Hex } from "../hash.js";
import type { DocUnit, FileDiff, SurfaceAdapter } from "../types.js";

/**
 * The three generated-content surfaces share one parser shape: every unit is
 * `generated: true` (their files carry a GENERATED header) and patch()
 * ALWAYS throws (constraints.md G8) — generated docs are regenerated, never
 * hand-patched.
 */
function makeGeneratedAdapter(
  surface: DocUnit["surface"],
  ownedGlobs: readonly string[],
  audience: DocUnit["audience"],
  register: DocUnit["editorial_register"],
): SurfaceAdapter {
  return {
    surface,
    ownedGlobs,
    parse(files): DocUnit[] {
      const units: DocUnit[] = [];
      for (const file of files) {
        if (file.path.startsWith("estate/")) {
          throw new Error(`mount prefix in adapter input: ${file.path} (I15)`);
        }
        if (!/\.(md|mdx)$/.test(file.path)) continue;
        const parsed = matter(file.content);
        const frontmatter = parsed.data as Record<string, unknown>;
        const body = parsed.content.trim();
        const title =
          typeof frontmatter.title === "string"
            ? frontmatter.title
            : (/^#\s+(.+)$/m.exec(body)?.[1] ?? file.path);
        units.push({
          id: `${surface}:${file.path}#page`,
          surface,
          path: file.path,
          anchor: "page",
          title,
          body,
          body_sha256: sha256Hex(body),
          audience,
          editorial_register: register,
          owner: "concord",
          generated: true,
          frontmatter,
        });
      }
      return units;
    },
    patch(unit): FileDiff {
      throw new Error(
        `patch() refused: ${unit.id} is generated (constraints.md G8) — regenerate it instead`,
      );
    },
  };
}

export const clidocsAdapter = makeGeneratedAdapter(
  "clidocs",
  ["cli-docs/**/*.md"],
  "developer",
  "technical_reference",
);

export const releaseAdapter = makeGeneratedAdapter(
  "release",
  ["release-notes/**/*.md"],
  "mixed",
  "release_note",
);

export const generatedAdapter = makeGeneratedAdapter(
  "generated",
  ["docs-mintlify/generated/**/*.mdx"],
  "agent",
  "technical_reference",
);
