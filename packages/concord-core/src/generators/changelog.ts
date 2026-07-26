import { marker, type Generator } from "./types.js";

/**
 * Changelog — `docs-mintlify/changelog.mdx`, generated from the T4 release
 * records carried in the snapshot (`release.<id>.changes` claims). The
 * release surface is a projection, not a source (architecture.md §5): the
 * authoritative records live in repo 1, which Concord cannot write.
 */
interface ReleaseClaim {
  version: string;
  released_at: string;
  summary: string;
  changes: { fact_key: string; from: unknown; to: unknown; kind: string }[];
}

export const changelogGenerator: Generator = {
  id: "changelog",
  generate(facts) {
    const releases = facts
      .filter((f) => /^release\.[a-z0-9_-]+\.changes$/.test(f.key))
      .map((f) => f.value as unknown as ReleaseClaim)
      .sort((a, b) => (a.released_at < b.released_at ? 1 : -1));
    const sections = releases.map((release) => {
      const date = release.released_at.slice(0, 10);
      const bullets = release.changes
        .map(
          (change) =>
            `- \`${change.fact_key}\`: ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)} (${change.kind})`,
        )
        .join("\n");
      return `## v${release.version} — ${date}\n\n${release.summary}.\n\n${bullets}`;
    });
    const content = `---
title: "Changelog"
description: "Product changes by release, generated from Relay's release records."
owner: "concord"
generated: true
---

${marker("release.<release_id>.changes (T4_RELEASE — temporal, never current values)")}

${sections.join("\n\n")}
`;
    return [{ path: "docs-mintlify/changelog.mdx", content }];
  },
};
