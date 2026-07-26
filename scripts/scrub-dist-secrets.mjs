// Phase 20 (validation.md §8, Secrets): the Cloudflare Vite plugin copies
// the worker directory — .dev.vars included — into dist/. The file is
// gitignored and wrangler never uploads it, but a real secret has no
// business sitting in build output. Delete it after every build, and fail
// loudly if a secret-shaped file survives.
import { existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = [join(process.cwd(), "dist")];
let removed = 0;
const walk = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (name === ".dev.vars" || name.startsWith(".dev.vars.") || name.endsWith(".pem")) {
      rmSync(full);
      removed += 1;
      console.log(`scrub-dist-secrets: removed ${full}`);
    }
  }
};
for (const root of roots) walk(root);
console.log(`scrub-dist-secrets: done (${removed} removed)`);
