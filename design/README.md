# design/theme.json — provenance and how to apply it

## What is original vs. derived

- **`elementStyles`** is verbatim, supplied by the operator ("Olive Folio"). It styles rendered *content* — headings,
  paragraphs, links, blockquotes, tables, code. Do not alter these values.
- **`palette`** and **`componentStyles`** are derived, not supplied. The original theme covers content but has no
  tokens for interactive chrome — buttons, inputs, focus states, status banners — which Phase 03's UI shell needs
  immediately. These were built by extracting the five colors already implied by `elementStyles` (primary, secondary,
  surface, border, text) and adding the four that had no equivalent (`error`, `warning`, `success`, `focusRing`),
  chosen to stay in the same warm, desaturated hue family rather than introducing an unrelated bright red/blue/green.

## Where to apply which part

- `elementStyles` → any rendered content: chat messages, analysis explanations, artifact tables, provenance/lineage
  text, the run inspector, evidence panels, changelog entries.
- `componentStyles` + `palette` → app chrome: buttons, form inputs, focus rings, empty/loading states, status
  banners, project/file list surfaces.
- If a screen needs a token neither section provides (e.g. a chart color for an analysis plot in a later phase),
  derive it from `palette` rather than introducing a new hue, and add it to this file so it becomes the shared source
  rather than a one-off choice buried in a component.

## Contrast — verified, not assumed

Every derived color was checked against WCAG 2.1 relative-luminance contrast (4.5:1 for normal text, 3:1 for large
text and non-text UI components), computed directly rather than eyeballed. Two derived colors failed on the first
pass and were darkened before being written into `theme.json` — the numbers below are for the values that shipped:

| Pair | Ratio | Result |
|---|---|---|
| `textPrimary` (#2f312b) on `background` (#f3f0e6) | 11.55:1 | comfortable |
| `primary`/link (#5e6538) on `background` | 5.43:1 | comfortable |
| `primaryText` (#ffffff) on `primary` button fill | 6.19:1 | comfortable |
| `error` (#8a3626) on `background` | 6.99:1 | comfortable |
| `warning` (#7a5420) on `background` | 5.92:1 | comfortable — **first draft `#a4762a` measured 3.54:1 and failed; darkened** |
| `success` (#3f6a3d) on `background` | 5.51:1 | comfortable — **first draft `#4f7a4a` measured 4.37:1 and narrowly failed; darkened** |
| `focusRing` (#5e6538) on `background`, as a non-text indicator (3:1 required) | 5.43:1 | comfortable |
| `textMuted` (#65685b) on `background` — from the ORIGINAL spec, not derived | 5.00:1 | passes, thin margin |
| `textFaint` (#6a6c60) on `background` — from the ORIGINAL spec, not derived | 4.69:1 | passes, thin margin |

**Two things worth carrying forward, not re-litigating:**
1. `textMuted` and `textFaint` pass today but with little headroom (~4.7–5.0 against a 4.5 requirement). Don't use
   them at small font sizes or thin font-weight, and don't darken any other token that sits near them without
   re-checking the pair.
2. If you introduce a color combination not listed above — a new hover state, a new status tint, anything layered
   with additional opacity — verify it the same way before shipping. Phase 20's security/hardening pass checks
   *behavior*, not contrast; nothing later in the packet re-verifies this.

## If `design/theme.json` did not exist when a phase started

The instruction in each UI phase is: check for this file first; if absent, stay neutral and unbranded rather than
inventing a brand. That fallback still applies to any screen or component this file doesn't cover.
