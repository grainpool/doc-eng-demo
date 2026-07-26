import { sha256Hex } from "../hash.js";
import type { DocUnit, FileDiff, SurfaceAdapter } from "../types.js";
import { makeDiff } from "../diff.js";

/**
 * Help-center adapter: a local fixture standing in for Intercom
 * (research-findings.md §5) — `help-center/index.json` for collections plus
 * one Markdown file per article. One DocUnit per article; register
 * friendly_help; audience end_user.
 */
export const helpcenterAdapter: SurfaceAdapter = {
  surface: "helpcenter",
  ownedGlobs: ["help-center/**/*.md", "help-center/index.json"],

  parse(files): DocUnit[] {
    const units: DocUnit[] = [];
    for (const file of files) {
      if (file.path.startsWith("estate/")) {
        throw new Error(`mount prefix in adapter input: ${file.path} (I15)`);
      }
      if (!file.path.endsWith(".md")) continue;
      const title = /^#\s+(.+)$/m.exec(file.content)?.[1] ?? file.path;
      const body = file.content.trim();
      units.push({
        id: `helpcenter:${file.path}#article`,
        surface: "helpcenter",
        path: file.path,
        anchor: "article",
        title,
        body,
        body_sha256: sha256Hex(body),
        audience: "end_user",
        editorial_register: "friendly_help",
        owner: "support-content",
        generated: false,
        frontmatter: {},
      });
    }
    return units;
  },

  patch(unit, newBody): FileDiff {
    if (unit.generated) {
      throw new Error(`patch() refused: ${unit.id} is generated (G8)`);
    }
    return makeDiff(unit.path, unit.body, newBody);
  },
};
