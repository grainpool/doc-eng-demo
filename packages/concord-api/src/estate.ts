/**
 * The estate files Concord reasons over in Phase 10, imported at BUILD time
 * through the repo-1 submodule mount. Paths are ESTATE-RELATIVE — the
 * `estate/` mount prefix never reaches an id (invariant I15).
 */
import supportedFiles from "../../../estate/docs-mintlify/supported-files.mdx";
import filesCopy from "../../../estate/in-product-copy/files.json";

export const ESTATE_FILES: ReadonlyArray<{ path: string; content: string }> = [
  { path: "docs-mintlify/supported-files.mdx", content: supportedFiles },
  {
    path: "in-product-copy/files.json",
    content: `${JSON.stringify(filesCopy, null, 2)}\n`,
  },
];
