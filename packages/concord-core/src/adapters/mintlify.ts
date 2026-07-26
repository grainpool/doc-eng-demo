import matter from "gray-matter";
import { sha256Hex } from "../hash.js";
import type { DocUnit, FileDiff, SurfaceAdapter } from "../types.js";
import { makeDiff } from "../diff.js";

/**
 * Mintlify adapter: .mdx pages → DocUnits keyed by heading anchors. Ids are
 * ESTATE-RELATIVE (`mintlify:docs-mintlify/x.mdx#anchor`) — the `estate/`
 * mount prefix must never appear in an id (contracts.md §2, invariant I15);
 * parse() throws if a caller hands it a mounted path.
 */

export function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

interface Section {
  anchor: string;
  title: string;
  body: string;
}

function splitSections(markdown: string, pageTitle: string): Section[] {
  const lines = markdown.split("\n");
  const sections: Section[] = [];
  let current: Section = { anchor: "intro", title: pageTitle, body: "" };
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current.body.trim().length > 0 || sections.length === 0) {
        sections.push(current);
      }
      current = {
        anchor: slugify(heading[2] as string),
        title: heading[2] as string,
        body: "",
      };
    } else {
      current.body += `${line}\n`;
    }
  }
  if (current.body.trim().length > 0 || sections.length === 0) {
    sections.push(current);
  }
  return sections;
}

export const mintlifyAdapter: SurfaceAdapter = {
  surface: "mintlify",
  ownedGlobs: ["docs-mintlify/**/*.mdx"],

  parse(files): DocUnit[] {
    const units: DocUnit[] = [];
    for (const file of files) {
      if (file.path.startsWith("estate/")) {
        throw new Error(
          `mount prefix in adapter input: ${file.path} — ids must be estate-relative (I15)`,
        );
      }
      if (!file.path.endsWith(".mdx")) continue;
      const parsed = matter(file.content);
      const frontmatter = parsed.data as Record<string, unknown>;
      const pageTitle =
        typeof frontmatter.title === "string" ? frontmatter.title : file.path;
      const generated = frontmatter.generated === true;
      for (const section of splitSections(parsed.content, pageTitle)) {
        const body = section.body.trim();
        units.push({
          id: `mintlify:${file.path}#${section.anchor}`,
          surface: "mintlify",
          path: file.path,
          anchor: section.anchor,
          title: section.title,
          body,
          body_sha256: sha256Hex(body),
          audience: "developer",
          editorial_register: "technical_reference",
          owner:
            typeof frontmatter.owner === "string"
              ? frontmatter.owner
              : "docs",
          generated,
          frontmatter,
        });
      }
    }
    return units;
  },

  patch(unit, newBody): FileDiff {
    if (unit.generated) {
      throw new Error(
        `patch() refused: ${unit.id} is generated (constraints.md G8) — regenerate it instead`,
      );
    }
    // The caller supplies the FULL new file content via before/after at a
    // higher level for multi-section pages; at unit granularity we produce
    // the body substitution within the original section.
    return makeDiff(unit.path, unit.body, newBody);
  },
};
