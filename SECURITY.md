# SECURITY.md — operational security notes (Phase 18)

The full threat model lives in the prompt packet (`security.md`); this file
records the OPERATED configuration and the steps a reader needs to
reproduce or audit it.

## Cloudflare Access — the identity gate

Team domain: `grainpool.cloudflareaccess.com` · Application AUD:
`be136ff79ded93a44ad0b615f810999d6128adcfbf86112a2e9daab09b599278`
(both are verification targets, not secrets — they ship as plain `vars`).

### Dashboard setup (operator-performed; reproduce as follows)
1. Zero Trust → Access → Applications → **Self-hosted**.
2. Application domain `concord.otonieltrejo.com`, paths `/api/admin` and
   `/admin` (two apps or two path entries covering both).
3. Policy: Action **Allow** · rule type **Include** · selector
   **"Emails ending in"** · value `@anthropic.com`.
4. Login method: **One-time PIN** (PINs expire 10 minutes after request).
5. Record the AUD tag → `ACCESS_AUD`; team domain → `ACCESS_TEAM_DOMAIN`.

### The misconfiguration to avoid
Do **not** add "One-time PIN" as an *Include rule* under Login Methods.
That policy reads as restrictive while admitting **every OTP user on the
internet**: OTP is the *authentication method*; the email-domain Include
rule is the *authorization*. If the only Include rule is the login method
itself, the app is wide open.

### Backend verification (independent of the edge)
`packages/concord-api/src/middleware/access.ts`:
- `DEMO_ADMIN_ENABLED !== "true"` → **404** — the privileged surface does
  not exist by default (invariant I12). The committed `wrangler.jsonc`
  deliberately does not set it; enabling is an explicit
  `wrangler deploy --var DEMO_ADMIN_ENABLED:true`.
- Missing `Cf-Access-Jwt-Assertion` → 403. No bypass branch exists
  (grep-asserted in `concord-core/test/no-dev-bypass.test.ts`).
- `jwtVerify` against `https://grainpool.cloudflareaccess.com/cdn-cgi/access/certs`
  with **issuer AND audience AND expiry** checked — signature-only
  verification would accept any Access team's token.
- The `@anthropic.com` email check is repeated in code. Two independent
  gates: the edge policy and the backend.
- Note the `workers.dev` host: requests there bypass the zone's edge
  Access entirely — which is exactly why backend verification is
  mandatory. Observed behavior: unauthenticated `/api/admin/*` on
  workers.dev → 403 from OUR middleware, not a redirect.

## ⚠ The Zero Trust seat cliff — the one cost with no code-level control

- This account is on **Zero Trust Free: 50 seats included**. The **51st
  distinct authenticator** converts the ENTIRE user count to paid
  (~$7/user/month — roughly **$357/month at seat 51**), with no partial
  billing.
- Access consumes a seat **at the edge, before any of our code runs**.
  Nothing in this repository can cap it. It is the only cost in the whole
  design with no application-level control — which is why it is an
  operator step, not a config value.
- **Before enabling the Access application**, configure a Cloudflare
  **billing / seat-count notification** (Zero Trust → Settings →
  Notifications, or Account Home → Notifications → "Zero Trust seat
  updates").
- **How to check the current seat count**: Zero Trust → My Team → Users —
  each listed user is a consumed seat; remove stale users from the same
  screen. Seat count at time of writing: operator-observed (not visible
  to CI or code); check before and after enabling the app.
- The policy stays `@anthropic.com` domain-wide per the requirement; it is
  NOT narrowed to an email list. If the seat count approaches 50, raise it
  with the operator and let them decide.

## Access logs are ephemeral; the audit log is durable

Zero Trust Free retains Access authentication logs for **24 hours**. The
D1 `audit_log` table (migration 0007) is therefore the durable record of
privileged actions: timestamp, Access email, mutation, run id, outcome,
PR url (null until Phase 19). It is append-only in application code, and
the public view (`GET /api/public/audit`) redacts the email's local part
to the domain.

## Mutation surface (security.md §4, implemented in code)

- Fact mutations: the **nine-key** closed-value allowlist in
  `packages/contracts/src/change-lab.ts` (`FACT_MUTATION_ALLOWLIST`). A key
  not in the table is `MUTATION_NOT_ALLOWED` before value validation.
- Doc-body mutations: only unit ids in
  `fixtures/changelab/editable-units.json` (repo 1 — an estate write can
  never widen the estate-writable set), ≤ 8192 bytes, and the §4.2 content
  filter (script/iframe/object/embed, `on*=`, `javascript:`, MDX
  expression braces, import/export, JSX outside `Note|Warning|Info|Tip`).
  MDX is executable; body edits are treated as untrusted code input.
- Live runs: mutations apply to a WORKING COPY of the snapshot/estate —
  never to deployed Relay configuration. One concurrent live run (D1
  lock; a second request is rejected naming the in-flight run id);
  ≤ 5 live runs per identity per hour; admin bodies ≤ 16 KB.
