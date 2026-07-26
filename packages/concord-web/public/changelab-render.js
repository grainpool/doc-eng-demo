/**
 * THE ChangeLabRun renderer — Phase 17. One renderer for replay AND live
 * (contracts.md §17): replay serves committed recordings of real runs;
 * Phase 18's live mode feeds the same shape through this same function.
 * If you are about to write a second renderer, stop.
 */
"use strict";

function clEsc(s) {
  const div = document.createElement("div");
  div.textContent = String(s);
  return div.innerHTML;
}

function clStage(name, subtitle, bodyHtml) {
  return (
    "<section style='border:1px solid #ddd;border-radius:8px;margin:1rem 0;overflow:hidden'>" +
    "<div style='background:#f8fafc;padding:.6rem 1rem;border-bottom:1px solid #eee'>" +
    "<b>" + clEsc(name) + "</b> <span style='color:#666'>" + clEsc(subtitle) + "</span></div>" +
    "<div style='padding: .8rem 1rem'>" + bodyHtml + "</div></section>"
  );
}

function clEvidencePanel(evidence) {
  if (!evidence || evidence.length === 0) return "";
  const REPO1 = "https://github.com/grainpool/doc-eng-demo/blob/main/";
  return (
    "<div style='border:1px solid #cbd5e1;background:#f8fafc;border-radius:6px;padding:.5rem .8rem;margin:.4rem 0'><b>Evidence</b>" +
    evidence
      .map(
        (e) =>
          "<div style='color:#555;font-size:.92em'>• <code>" + clEsc(e.fact_key) + "</code> (" + clEsc(e.tier) +
          ") = <code>" + clEsc(JSON.stringify(e.value)) + "</code> — <a href='" + REPO1 +
          clEsc(String(e.locator).split("#")[0]) + "'>" + clEsc(e.locator) + "</a></div>",
      )
      .join("") +
    "</div>"
  );
}

/** run: a ChangeLabRun (contracts.md §17). Returns HTML for every stage. */
function renderChangeLabRun(run) {
  const m = run.mutation;
  const impactsBy = (action) => run.impacts.filter((i) => i.action === action);
  const stepByName = Object.fromEntries(run.steps.map((s) => [s.name, s]));
  const pipelineDetail = (stepByName.pipeline && stepByName.pipeline.detail) || {};

  const changeHtml =
    "<p>Mutation: <code>" + clEsc(m.kind) + "</code> — <code>" + clEsc(m.fact_key || m.doc_unit_id) +
    "</code> → <code>" + clEsc(JSON.stringify(m.value !== undefined ? m.value : m.body)) + "</code>" +
    " <span style='color:#666'>(mode " + clEsc(run.mode) + ", run " + clEsc(run.run_id) + ", status " + clEsc(run.status) + ")</span></p>";

  const detectHtml =
    run.detected_facts.length === 0
      ? "<p style='color:#666'>No fact deltas this run.</p>"
      : run.detected_facts
          .map((f) => {
            const impact = run.impacts.find((i) => i.fact_key === f.key);
            const delta = impact ? impact.delta : null;
            return (
              "<div>• <code>" + clEsc(f.key) + "</code>" +
              (delta ? ": <code>" + clEsc(JSON.stringify(delta.from)) + "</code> → <code>" + clEsc(JSON.stringify(delta.to)) + "</code>" : "") +
              " <span style='color:#666'>(" + clEsc(f.tier) + " @ " + clEsc(f.locator) + ")</span></div>"
            );
          })
          .join("");

  const normalizeHtml =
    "<p>" + clEsc(pipelineDetail.units != null ? pipelineDetail.units : "?") + " doc units across six surfaces; " +
    clEsc(pipelineDetail.projections != null ? pipelineDetail.projections : "?") + " fact projections.</p>";

  const traceHtml =
    run.impacts.length === 0
      ? "<p style='color:#666'>No impacts.</p>"
      : run.impacts
          .map(
            (i) =>
              "<div style='border:1px solid #eee;border-radius:6px;padding:.5rem .8rem;margin:.4rem 0'>" +
              "<div><b>" + clEsc(i.action) + "</b> <span style='color:#666'>rule " + clEsc(i.classification_rule) +
              " · " + clEsc(i.disposition) + (i.resolution_note ? " · " + clEsc(i.resolution_note) : "") + "</span></div>" +
              "<div><code>" + clEsc(i.doc_unit_id) + "</code></div>" +
              "<p style='margin:.3rem 0'>" + clEsc(i.explanation) + "</p></div>",
          )
          .join("");

  const deterministicPatches = run.patches.filter((p) => p.origin === "deterministic");
  const modelPatches = run.patches.filter((p) => p.origin !== "deterministic");
  const patchBlock = (p) =>
    "<div style='border:1px solid #eee;border-radius:6px;padding:.5rem .8rem;margin:.5rem 0'>" +
    "<div><b>" + clEsc(p.origin) + "</b> <code>" + clEsc(p.diff.path) + "</code>" +
    (p.requires_review ? " <span style='color:#b35900'>REVIEW REQUIRED — never auto-applied</span>" : " · may auto-apply") + "</div>" +
    (p.changed_because ? "<div style='color:#555'>why: " + clEsc(p.changed_because) + "</div>" : "") +
    (p.needs_human_because ? "<div style='color:#b35900'>needs a human: " + clEsc(p.needs_human_because) + "</div>" : "") +
    clEvidencePanel(p.evidence) +
    (p.validation
      ? "<div style='color:#666;font-size:.9em'>validation: " +
        Object.entries(p.validation).filter(([k]) => k !== "falsification").map(([k, v]) => k + "=" + clEsc(v)).join(" · ") + "</div>"
      : "") +
    "<pre style='background:#f4f4f0;padding:.6rem;overflow-x:auto'>" + clEsc(p.diff.unified) + "</pre></div>";

  const conflictsHtml =
    run.conflicts.length === 0
      ? "<p style='color:#666'>No conflicts this run.</p>"
      : run.conflicts
          .map(
            (c) =>
              "<div style='border:1px solid #eee;border-left:4px solid #b30000;border-radius:6px;padding:.5rem .8rem;margin:.5rem 0'>" +
              "<div><b>" + clEsc(c.kind) + "</b> <code>" + clEsc(c.fact_key) + "</code> · likely owner <b>" + clEsc(c.likely_owner) + "</b>" +
              " · resolution <code>" + (c.resolution === null ? "null (Concord never resolves)" : clEsc(c.resolution)) + "</code></div>" +
              "<div style='display:flex;gap:.8rem;flex-wrap:wrap;margin:.4rem 0'>" +
              c.claims.map((cl) =>
                "<div style='flex:1;min-width:14rem;border:1px solid #ddd;border-radius:6px;padding:.4rem .7rem'><b>" + clEsc(cl.tier) +
                "</b> claims <code>" + clEsc(JSON.stringify(cl.value)) + "</code><div style='color:#666;font-size:.9em'>" + clEsc(cl.locator) + "</div></div>",
              ).join("") + "</div>" +
              "<div style='color:#666'>Missing: " + c.missing_information.map(clEsc).join(" · ") + "</div>" +
              "<p><b>Suggested question:</b> " + clEsc(c.suggested_question) + "</p></div>",
          )
          .join("");

  const reviews = run.patches.filter((p) => p.requires_review);
  const suppressed = run.findings.filter((f) => f.disposition === "suppressed");

  return (
    clStage("1 · change", "the mutation entering the pipeline", changeHtml) +
    clStage("2 · detect", "product facts and deltas, with source tiers", detectHtml) +
    clStage("3 · normalize", "the estate as doc units + projections", normalizeHtml) +
    clStage("4 · trace impact", "every affected unit, and WHY", traceHtml) +
    clStage(
      "5 · reconcile",
      "deterministic first; the model only where mechanics end",
      "<p>" + clEsc(impactsBy("DETERMINISTIC_REGEN").length) + " deterministic · " +
        clEsc(impactsBy("GROUNDED_PATCH").length) + " grounded · " +
        clEsc(impactsBy("EDITORIAL_REVIEW").length) + " editorial · " +
        clEsc(impactsBy("UNRESOLVED_CONFLICT").length) + " conflict-blocked · " +
        clEsc(impactsBy("NO_ACTION").length) + " already correct</p>" +
        (deterministicPatches.length ? "<h4>Deterministic updates</h4>" + deterministicPatches.map(patchBlock).join("") : ""),
    ) +
    clStage(
      "6 · validate",
      "evidence gates + adversarial falsification",
      (modelPatches.length ? "<h4>Proposed AI patches</h4>" + modelPatches.map(patchBlock).join("") : "<p style='color:#666'>No model patches this run.</p>") +
        (suppressed.length
          ? "<h4>Suppressed findings (falsifier)</h4>" + suppressed.map((f) =>
              "<div style='color:#666;border-left:3px dashed #999;padding-left:.6rem;margin:.3rem 0'><code>" + clEsc(f.fact_key) +
              "</code> " + clEsc(f.detail.slice(0, 160)) + "<br><b>refuted:</b> " + clEsc(f.refutation || "") + "</div>",
            ).join("")
          : ""),
    ) +
    clStage("7 · patch / escalate", "conflicts, owners, and required reviews", conflictsHtml +
      (reviews.length ? "<p><b>" + reviews.length + " patch(es) require human review</b> — there is no code path that applies a model patch automatically.</p>" : "")) +
    clStage(
      "8 · publish",
      "release entry, provenance, and cost",
      (run.generated_release_entry
        ? "<h4>Generated changelog entry</h4><pre style='background:#f4f4f0;padding:.6rem;overflow-x:auto'>" + clEsc(run.generated_release_entry) + "</pre>"
        : "<p style='color:#666'>No changelog regeneration this run (fact changes do not rewrite history; a release record lands in repo 1 first).</p>") +
        (run.pull_request_url ? "<p>PR: <a href='" + clEsc(run.pull_request_url) + "'>" + clEsc(run.pull_request_url) + "</a></p>" : "") +
        "<p style='color:#666'>Model usage in the RECORDED run: " + clEsc(run.model_usage.calls) + " call(s), " +
        clEsc(run.model_usage.input_tokens) + " in / " + clEsc(run.model_usage.output_tokens) + " out, ≈$" +
        clEsc(run.model_usage.estimated_usd) + ". Serving this replay made ZERO model calls.</p>",
    )
  );
}
