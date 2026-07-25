# supporting-spec-index.md — What each doc is for, and when it matters

Read this first if you are the coding agent. It tells you which document answers which kind of question, and which
document wins when two seem to conflict.

## Precedence order (highest first)

1. **`constraints.md`** — non-goals and guardrails. If anything else appears to authorize something this forbids, this
   wins, and you must say so in your response rather than resolving it silently.
2. **`contracts.md`** — names, shapes, enums, invariants. Binding.
3. **`security.md`** — threat model and controls. Binding for any auth, mutation, path, spend, or logging decision.
4. **`architecture.md`** — component boundaries, data flow, decisions already made.
5. **`research-findings.md`** — verified platform reality and the deviations from the original spec.
6. **`implementation-plan.md`** — phase objectives, scope fences, acceptance criteria.
7. **`validation.md`** — the tests and checklists a phase must satisfy.
8. **The phase prompt** — narrows all of the above to this phase's slice.

`meta.md` and `operator-runbook.md` are for the human operator. You will not be given either. Everything you need to
know about a human-action gate is restated in the phase prompt that depends on it — see "Operator gates" below.

## Document guide

| Document | Answers | Consult when |
|---|---|---|
| `constraints.md` | "Am I allowed to build this?" "Is this an anti-pattern?" "What library may I add?" | **Every phase, before you start.** Especially §2 anti-patterns before any Concord work, and §3 G18 before adding a dependency. |
| `contracts.md` | "What is this type called?" "What are the enum values?" "What must always be true?" | Any time you define a schema, name a field, add an ID, or write a route. §18 is the invariant list to test against. |
| `security.md` | "How do I verify identity?" "Can this path be written?" "What may I log?" "What is the spend cap?" | Phases 04, 05, 14, 17, 18, 19, 20. Also any time you touch an env var or write a log line. |
| `architecture.md` | "Where does this code live?" "What calls what?" "How is a run executed?" "What happens when X fails?" | Phase 01 (whole file), then §6.1 for every Concord classification decision and §9 for every error path. |
| `research-findings.md` | "Is this platform feature real?" "Why not Pyodide / Pages / Workflows / Intercom?" "What are the exact limits?" | Phase 01, 04, 11, 18, 19. Read the "Deviations" table before questioning an architecture choice. |
| `implementation-plan.md` | "What is in scope for this phase?" "What must I NOT build yet?" | Start of every phase. The "wait until later" list is the scope fence. |
| `validation.md` | "How do I know I'm done?" "What test file must exist?" | End of every phase. §2 names the test file for your phase. §8 is Phase 20's gate. |

## Cross-references you will need repeatedly

| Question | Location |
|---|---|
| The six product-truth source tiers | `architecture.md` §4 · `contracts.md` §3.1 |
| The action-class decision table | `architecture.md` §6.1 (rules) · `contracts.md` §13 (types) |
| The eight analysis operations | `contracts.md` §4.1 |
| The fact-key registry | `contracts.md` §3.1 |
| Doc-unit id format (must be stable) | `contracts.md` §2 |
| The adapter interface | `contracts.md` §11 |
| Patch evidence requirements | `contracts.md` §14 |
| Why conflicts are never auto-resolved | `contracts.md` §15 · `constraints.md` §2 AP3 |
| The 12 defect classes | `contracts.md` §16 |
| The mutation allowlist (9 keys) | `security.md` §4.1 |
| The repo path allowlist / denylist | `security.md` §4.3 |
| Access JWT verification code | `security.md` §2 |
| Spend caps and where they're checked | `security.md` §5 · `constraints.md` §4 |
| Workers limits that shaped the design | `research-findings.md` §1 |
| Anthropic API rules (no `temperature`, refusal handling, structured outputs) | `research-findings.md` §7 · `constraints.md` §G10–G13 |
| The invariant list to assert | `contracts.md` §18 |
| The two-repo boundary and one-way write direction | `architecture.md` §1.1 · `constraints.md` §G21 · `security.md` §4.3 |

## Files the build creates that later phases depend on

Treat these as living inputs, not outputs. Later phases read them.

| File | Created | Read by |
|---|---|---|
| `COMPAT.md` | 01, appended thereafter | every phase — records observed platform reality and deviations |
| `NOTES.md` | 01, appended | you, for ideas deferred out of the current phase |
| `fixtures/cli-introspection.json` | 07 | 08 (T2 facts), 13 (CLI doc generation) |
| `CONTRACTS-FROZEN.md` | 09 | 10–20 — what Concord may rely on |
| `fixtures/eval/defects.json` | 16, but seeded earlier (08, 11) | 16 — in-memory injections, never committed into the estate |
| `fixtures/runs/*.json` | 17 | 17 public replay |
| `fixtures/changelab/editable-units.json` | 17 | 18 doc-body allowlist |
| `estate/` (submodule pin) | 01 | every phase from 11 onward |
| `eval-report.md` / `.json` | 16, refreshed 20 | 20 README + failures page |

## Operator gates — human work you must wait for, never simulate

Some work in this project is **not yours to do**, either because it requires an account you do not have, an interactive
consent screen, or acceptance of a cost on the operator's account. The operator has a full runbook
(`operator-runbook.md`) covering these; you will not be given it. What matters to you is the behaviour at each gate.

**Data the operator supplies — ask, do not invent:**

| Needed | Phase | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | 01 | Via `wrangler secret put`. Never write it to a file. |
| The literal hostnames for Relay, Concord, and docs | 01 | Do not guess a domain. |
| Cloudflare account id | 01 | For `wrangler.jsonc`. |
| The **estate repo** clone URL | 01 | Repo 2 must exist (may be empty) so the submodule can be wired. It must have **no `.github/` directory**, then or ever. |
| Brand / visual preferences | 03 (Relay UI), 17 (Concord UI) | If not supplied, keep both UIs plain, legible, and unbranded. Do not invent a brand, logo, or colour system. |
| The live docs hostname, once Mintlify is publishing | 11 | Either `docs.<domain>` or an assigned `*.mintlify.app` subdomain. Phase 20 fetches `/llms.txt` from it by name. |
| `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` | 18 | After the operator creates the Access application. |
| GitHub App id, installation id, private key | 19 | After the operator creates the App and installs it on the estate repo **only**. |

**Configuration the operator performs — verify, do not attempt:**

| Action | Phase | Your job |
|---|---|---|
| Mintlify account + GitHub app connected to repo 2 + `docs` CNAME | 11 | Author `docs.json` and the pages. Then confirm the site is live and `/llms.txt` serves. If it is not, say so plainly — do not hand-author `llms.txt` to compensate (§G7). |
| Zero Trust team domain + seat/billing notification | 18 | Document the seat cliff and how to check the count. Tell the operator to configure the notification *before* enabling the app. |
| The Cloudflare Access application | 18 | Document the exact configuration in `SECURITY.md`, including the OTP-as-Include-rule misconfiguration to avoid. |
| GitHub App creation + installation scope | 19 | Document the three permissions and the single-repo installation. Never substitute a PAT. |
| **Branch protection on `main` of the estate repo** | 19 | Operator-configured in GitHub's UI. You cannot set it and the App does not grant it. Verify a direct push to `main` is rejected, and document why this layer is required. |

**The rule, in all cases:** if a gate's input or configuration is missing when you reach it, **stop and ask for that one
item.** Do not stub it with a placeholder that could be mistaken for working code, do not commit a fake value, do not
comment out the dependent code path, do not mark the step "skipped for now", and do not attempt the dashboard
configuration yourself. A missing credential is a two-minute interruption; a fabricated one that typechecks is a defect
that survives to production.

Equally: **never report a verification as passing when its operator gate is unsatisfied.** If Mintlify is not connected,
"the served `/llms.txt` reflects the reconciled descriptions" is unverifiable, and saying so is the correct output.

## No user-supplied reference documents are required

This packet is self-contained; the operator supplied prose requirements rather than files. If the operator later hands
you a design spec, brand guide, or content style guide, treat it as **binding for its own domain** (visual design,
copy voice) and as **subordinate to `contracts.md` and `security.md`** for anything structural. Add it to this index
when it arrives.
