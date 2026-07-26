# concord-web

The Concord UI: static pages served as the concord-api Worker's assets. No framework, no build
step — plain HTML + one shared renderer, which is the point: the public replay and the privileged
live mode render through **the same code path**.

| Page | What it shows |
|---|---|
| `index.html` | Run inspector — load any run by id (`?run=<id>` deep-links from PR bodies): impacts with their decision chains, patches with diffs, conflicts, active AND suppressed findings (with refutations), steps, spend. |
| `changelab.html` | The public Change Lab: five recorded REAL runs replayed through the renderer. |
| `admin/index.html` | The live Change Lab (behind Cloudflare Access + backend verification): nine allowlisted fact mutations or a doc-body edit on ten editable units → a real run → a real PR. |
| `facts.html` | The fact browser — every projection of a fact with extractor and confidence. |
| `failures.html` | Generated from the eval report: every miss, with analysis. Never hand-edited. |
| `changelab-render.js` | THE renderer. One `ChangeLabRun` shape in, eight stages out. Replay and live both call it. |

Recordings in `fixtures/runs/` are real runs captured against live deploys (the recorder is
`scripts/record-changelab.mjs` in the repo root) — never hand-authored, pinned to the estate SHA
they ran against.
