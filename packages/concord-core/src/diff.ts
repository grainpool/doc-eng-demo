import type { FileDiff } from "./types.js";

/** Minimal unified diff (line-granular, single hunk) — enough for review UI. */
export function makeDiff(path: string, before: string, after: string): FileDiff {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  let start = 0;
  while (
    start < beforeLines.length &&
    start < afterLines.length &&
    beforeLines[start] === afterLines[start]
  ) {
    start++;
  }
  let endBefore = beforeLines.length;
  let endAfter = afterLines.length;
  while (
    endBefore > start &&
    endAfter > start &&
    beforeLines[endBefore - 1] === afterLines[endAfter - 1]
  ) {
    endBefore--;
    endAfter--;
  }
  const removed = beforeLines.slice(start, endBefore);
  const added = afterLines.slice(start, endAfter);
  const hunk =
    removed.length + added.length === 0
      ? ""
      : [
          `@@ -${start + 1},${removed.length} +${start + 1},${added.length} @@`,
          ...removed.map((l) => `-${l}`),
          ...added.map((l) => `+${l}`),
        ].join("\n");
  return {
    path,
    before,
    after,
    unified: `--- a/${path}\n+++ b/${path}\n${hunk}${hunk ? "\n" : ""}`,
  };
}
