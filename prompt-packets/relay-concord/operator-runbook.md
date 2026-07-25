# operator-runbook.md — every action only a human can perform

This is the complete list of work **you** do, in phase order. Everything not listed here is the coding agent's job.

The packet is otherwise self-contained, but four kinds of work cannot be delegated to an agent no matter how good it is:

1. **Creating accounts** on third-party services (Mintlify, Anthropic, GitHub, Cloudflare Zero Trust).
2. **Console/dashboard configuration** that has no API path the agent is authorized to use, or that requires an
   interactive OAuth consent screen (the Access application, the GitHub App, Mintlify's repo connection).
3. **Handing over credentials** the agent must never generate, guess, or find on disk.
4. **Accepting a cost or risk on the account** — branch protection, billing notifications, spend caps.

**The rule the agent follows, in every prompt:** if a gate below has not been satisfied, it must STOP and ask you by
name for the specific item. It must not invent a placeholder value, comment out the dependent code, mark the step
"skipped for now", or attempt the dashboard work itself. A fabricated credential that typechecks is worse than a halt.

---

## Gate summary

| Gate | Phase | Blocking? | What you do | Time | Hand back |
|---|---|---|---|---|---|
| **OG-0** | before 01 | Yes | Prerequisites — accounts, repos, plans, local `wrangler login` | done, verify only | — |
| **OG-1** | 01 | Yes | Provide the Anthropic API key for `wrangler secret put` | 1 min | the key, out of band |
| **OG-2** | 01 | Only if it fails | Create the R2 bucket in the dashboard, or re-`wrangler login` | 2 min | confirmation |
| **OG-3** | 11 | **Yes, and currently the easiest one to forget** | Mintlify: account, connect repo 2, custom domain + DNS | 20–30 min | the live docs hostname |
| **OG-4** | 18 | Yes | Zero Trust team domain, seat notification, Access application | 20 min | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` |
| **OG-5** | 19 | Yes | GitHub App: create, install on repo 2 only, private key | 15 min | app id, installation id, `.pem` |
| **OG-6** | 19 | Yes | Branch protection on `main` of the estate repo | 3 min | confirmation |

Total human time across the whole build: roughly **75 minutes**, unevenly distributed. Phases 02–10 and 12–17 require
nothing from you but verification.

---

## OG-0 — Prerequisites, before Phase 01

Already satisfied on this account as of 2026-07-25. Verify rather than redo.

| Item | State | Note |
|---|---|---|
| GitHub org `grainpool` | ready | Same operational identity as the Cloudflare account. |
| Repo 1 `grainpool/doc-eng-demo` | exists, public, empty | CI lands here in Phase 01. |
| Repo 2 `grainpool/doc-eng-demo-estate` | exists, public, empty, **no `.github/`** | Never add one. Not a workflow, not a `dependabot.yml`, not an issue template. |
| Cloudflare account `589e5ae8…` | Workers Paid + R2 Paid | Containers, D1, Queues licensed and unprovisioned. |
| Zone `otonieltrejo.com` | active, Free plan | **No upgrade needed.** Do not buy Pro for this project. |
| Anthropic API key | ready | Not committed anywhere. |
| Anthropic Console org spend limit | **already configured** | This is the backstop for the in-app $5/day cap. The app-level cap is a product behaviour; this is the account-level floor under it. |
| `wrangler` authenticated locally | verify with `wrangler whoami` | See OG-2 for the known R2 scope wrinkle. |

**Two non-blocking to-dos, worth doing before Phase 18:**

- **Enable 2FA on the Cloudflare account.** `enforce_twofactor` is currently `false`, and this account will hold the
  Anthropic key and the GitHub App private key. Do it whenever; do it before the project is public.
- Decide now whether you are comfortable with the Zero Trust seat exposure described in OG-4. It is the only
  uncapped cost in the design.

---

## OG-1 — Anthropic API key · Phase 01 · blocking

**What the agent needs:** the key value, so it can run `wrangler secret put ANTHROPIC_API_KEY`.

**How to hand it over:** paste it into the session when the agent asks, or run the `wrangler secret put` command
yourself and tell the agent it is set. The second is better hygiene and the agent handles either.

**Never:** put it in `wrangler.jsonc` `vars`, `.dev.vars` committed to git, an environment file in the repo, or a
message you would not want in a transcript you later publish. Phase 01 installs a pre-commit secret scan for
`sk-ant-`, but that is a net, not a policy.

**If skipped:** the fifth health check fails and Phase 01 cannot reach its definition of done. The agent is instructed
to stop rather than stub the Anthropic call.

---

## OG-2 — R2 bucket creation · Phase 01 · conditional

`wrangler whoami` on this account lists **no R2 scope**, even though `wrangler r2 bucket list` succeeds. This is a
token-scope artifact and it may or may not bite.

**Trigger:** the agent reports that `wrangler r2 bucket create relay-artifacts` failed on permissions.

**What you do:** either re-run `wrangler login` and re-consent with R2 scopes, or create the bucket named
`relay-artifacts` in the Cloudflare dashboard under R2. Either takes under a minute.

**Do not let the agent work around this.** It is instructed to surface the failure immediately rather than switch to
KV, the filesystem, or a stub. Whichever path resolved it gets recorded in `COMPAT.md`.

**Naming:** the buckets `gp-prod-uploads` and `numi-backups-prod` already exist on this account and are unrelated.
`relay-artifacts` and `concord-runs` are free.

---

## OG-3 — Mintlify · Phase 11 · blocking

**This is the gate most likely to be missed, because nothing fails loudly at Phase 11 when you skip it.** The agent
authors `docs.json` and ~14 MDX pages, the tests pass, and the phase looks complete — but nothing is publishing, and
nine phases later Phase 20 asks the agent to fetch the served `/llms.txt` and confirm it reflects the reconciled
descriptions. That check is impossible without a live site, and "reconcile the inputs to Mintlify's generated
machine-readable output" is one of the project's actual claims. Do this at Phase 11.

**This gate does not halt the agent** — that is deliberate. The other five surfaces and all the golden tests are
independent of Mintlify, so the agent keeps working while you set this up. What it cannot do is *close* Phase 11 without
it. Expect the phase to end with everything green and this one item held open.

**Sequence — run it after the agent has committed `docs-mintlify/docs.json` and the first pages to repo 2:**

1. **Create a Mintlify account** at mintlify.com using the GitHub identity that owns `grainpool`.
2. **Install the Mintlify GitHub app on `grainpool/doc-eng-demo-estate` only.** It needs read access to the repo
   contents. Do not install it on repo 1.
3. **Point the project at the `docs-mintlify/` subdirectory.** The estate repo has three surfaces at its root and
   only one of them is the Mintlify project. If Mintlify is pointed at the repo root the build will fail or index the
   wrong files.
4. **Trigger a build and confirm the site renders** on the `*.mintlify.app` subdomain Mintlify assigns.
5. **Add the custom domain** in the Mintlify dashboard. It will show you a CNAME target — use exactly what it shows.
6. **Create the DNS record** in the Cloudflare dashboard for zone `otonieltrejo.com`: a `CNAME` at `docs` pointing to
   Mintlify's target. If Mintlify's setup page says the record must be DNS-only rather than proxied, follow that;
   do not guess the proxy setting.
7. **Verify** `https://docs.otonieltrejo.com` serves the site, and that `https://docs.otonieltrejo.com/llms.txt`
   returns generated content.

**Hand back:** the live docs hostname. Whatever it is, it becomes the value the agent uses everywhere `docs.<domain>`
appears in the packet.

**If a custom domain turns out to require a paid Mintlify plan on your account:** the fallback is the assigned
`*.mintlify.app` subdomain. It costs nothing and nothing in the architecture depends on the hostname. Tell the agent
which one you used — Phase 20 fetches `/llms.txt` from it by name.

**On the second GitHub app:** installing Mintlify's app on repo 2 does not weaken the Phase 19 security argument.
That argument is *repo 2 contains no CI, so a visitor-authored branch cannot reach a privileged workflow*. It is a
property of the repo's contents, not of how many apps are installed. Mintlify reads and publishes; it does not
execute anything the estate repo defines. Concord's App is still the only app on repo 2 with `Contents: write`.

**If skipped:** Phase 20 step 4 cannot be verified, and the agent will either say so honestly (correct behaviour, and
it is now instructed to) or you will get a fabricated pass. Neither is a good use of the phase.

---

## OG-4 — Cloudflare Zero Trust and the Access application · Phase 18 · blocking

Three separate things, in this order. Do not skip step 2 — it is the one with money attached.

### 1. Zero Trust team domain (one time, only if you have never used Zero Trust on this account)

Cloudflare will ask you to choose a team name the first time you open Zero Trust. That name becomes
`<team>.cloudflareaccess.com`, which is the `ACCESS_TEAM_DOMAIN` the middleware verifies `iss` against. It is
awkward to change later. Pick it deliberately.

### 2. The seat notification — do this *before* enabling the application

This account is on **Teams Free: 50 seats included**. The 51st distinct person who authenticates moves the entire
count to **$7/user/month with no partial billing** — roughly **$357/mo** at seat 51.

Access consumes seats **at the edge**, before any of our code runs. There is no application-level control that can
prevent it. This is the one cost in the entire design that cannot be capped in code, which is exactly why it gets a
human step: **configure a Cloudflare billing/seat notification now**, and know where the current seat count is
displayed so you can check it.

The `@anthropic.com` domain rule is the intended policy and the agent is instructed **not** to narrow it to an
individual email list on its own initiative. If the count climbs toward 50, narrowing it is your call to make.

Also note: Teams Free retains Access logs for only **24 hours**. That is why the D1 `audit_log` is the durable record
of who did what, and why the agent builds it as append-only.

### 3. The Access application

Create a **self-hosted** application in Zero Trust:

- **Domain:** `concord.otonieltrejo.com`, covering the paths `/api/admin` and `/admin`.
- **Policy:** Action `Allow`; rule type `Include`; selector **"Emails ending in"**; value `@anthropic.com`.
- **Login method:** One-time PIN, 10-minute expiry.

**The misconfiguration to avoid:** "One-time PIN" must **not** appear as an *Include rule* under Login Methods. OTP
is the authentication *method*; the email-domain rule is the *authorization*. Configured as an Include rule, it
admits every OTP user on the internet — the policy would read as if it were restrictive while being wide open.

**Hand back:**
- `ACCESS_TEAM_DOMAIN` — your `<team>.cloudflareaccess.com`
- `ACCESS_AUD` — the Application Audience (AUD) tag from the application's overview page

**If skipped:** the agent cannot write a working `access.test.ts` against real values and cannot verify the six
rejection cases. It is instructed to stop and ask. Note that the middleware is default-off
(`DEMO_ADMIN_ENABLED !== "true"` returns 404), so an unconfigured Access app leaves the privileged surface
unreachable rather than open — but "unreachable" is not "verified".

---

## OG-5 — The Concord GitHub App · Phase 19 · blocking

**Create the App** under the `grainpool` account:

- **Permissions — exactly three, nothing else:**
  - `Contents: write`
  - `Pull requests: write`
  - `Metadata: read`
  - `Contents: write` is required because `Pull requests: write` alone cannot create a branch. That asymmetry is
    documented in `SECURITY.md` so the scope reads as deliberate rather than lazy.
- **Webhook:** not needed. Disable it.
- **Install on `grainpool/doc-eng-demo-estate` and nowhere else.** Not on repo 1, not org-wide, not "all repositories".
  This is the layer that makes repo 1 *unreachable* rather than merely *disallowed*, and it is the only layer that
  cannot be re-established by the agent if you get it wrong.
- **Generate and download a private key** (`.pem`).

**Hand back:** the App id, the installation id, and the private key. The key goes in via `wrangler secret put`, same
discipline as the Anthropic key.

**Do not substitute a personal access token** if the App setup is annoying. A PAT is account-scoped, long-lived, and
defeats three of the four security layers at once. The agent is instructed to refuse this substitution.

---

## OG-6 — Branch protection on the estate repo · Phase 19 · blocking

Separate from OG-5 and easy to conflate with it. This is a **repository setting you configure**, not something the
App grants and not something the agent can do with its permissions.

On `grainpool/doc-eng-demo-estate`, protect `main`:

- Require a pull request before merging
- Block force pushes
- Block branch deletion

**Why it matters:** the App holds `Contents: write`. Without branch protection, `Contents: write` can commit straight
to `main` — which would mean an AI-proposed documentation patch, triggered by a visitor, landing on the published
docs site with no human in the loop. Branch protection is what forces that token down the PR path. It is one of the
four independent layers in `security.md` §1, and unlike the other three it lives entirely in GitHub's UI.

**Verify it:** after the agent's first successful run, confirm the PR exists and that a direct push to `main` is
rejected. Phase 19's definition of done includes "`main` cannot be pushed to directly" — that line is checking your
work, not the agent's.

---

## Ongoing, not gated to a phase

Neither of these blocks a phase. Both are yours because they involve money or an account-level decision.

- **Zero Trust seat count.** Check it whenever you share the demo widely. See OG-4 step 2.
- **Anthropic spend.** The org-level console limit is already set and is the real backstop. The app enforces ≤ 20
  model calls per run, ≤ $5 per UTC day, ≤ 5 live runs per identity per hour, and one concurrent live run — Phase 20
  forces each of those rather than reading the code. Zero model calls occur on public paths by design.

---

## What is *not* your job

Listed so you do not duplicate work the agent is doing, or wait on something that was never blocked.

| Thing | Who | Note |
|---|---|---|
| Creating D1 databases, R2 buckets, the Queue | agent, via `wrangler` | Except the OG-2 fallback. |
| Building and pushing the container image | agent, via `wrangler` | `containers:write` and `cloudchamber:write` are present. |
| Worker custom domains (`relay.`, `concord.`) | agent, via `wrangler` | The zone is in the same account. If this fails on scopes, it becomes a dashboard task like OG-2 — the agent will say so. |
| Wiring the estate submodule | agent | Phase 01. |
| Writing `docs.json`, MDX pages, `markdown.instructions` | agent | Phase 11. You only connect Mintlify to the result. |
| Creating the `docs` DNS record | **you** | OG-3 step 6. This one *is* yours. |
| Everything in `.github/workflows/` | agent, repo 1 only | Repo 2 never gets a `.github/`. |
