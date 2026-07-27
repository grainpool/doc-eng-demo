# research-findings.md — package decisions (verified July 2026)

Decisions were made during packet generation, per the planning instruction. The coding agent does
not re-open them; it verifies exact minor versions at install time against official docs.

## Chat stack — DECIDED: assistant-ui primitives over AI SDK v6

- **AI SDK 6** shipped 2026-05-07 (`ai@^6`, `@ai-sdk/react@^3`). Breaking vs v5: no compat layer,
  `providerOptions` replaces inline model params, unified message-**parts** model on `useChat`, new
  UI-message streaming wire format. Server side: `streamText({...}).toUIMessageStreamResponse()`
  returns a standard `Response` — works from a Hono route on Cloudflare Workers (no Next.js
  dependency; official docs state "any framework with a Node-compatible API route", and Workers'
  `Response` streaming qualifies — the existing Worker already streams R2 bodies).
- **assistant-ui** (`@assistant-ui/react`, MIT) supports AI SDK v4/v5/v6 and recommends v6 for new
  projects, via `@assistant-ui/react-ai-sdk` which wraps `useChat` as an assistant-ui runtime.
  Framework-agnostic on the frontend — Vite is fine.
- **Styling**: assistant-ui's prebuilt styled components assume Tailwind. Relay has no Tailwind and
  must not gain a second styling system (constraints). Use the **unstyled primitives**
  (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ThreadListPrimitive`) and style
  them from the existing `theme.ts` / Olive Folio tokens.
- **Provider**: `@ai-sdk/anthropic` at the major matching `ai@6` (verify exact version at install).
  Model id comes from the existing `MODEL_ID` constant in `@relay/contracts` — never a literal.
- **Kept out**: the existing analysis translation/narration paths stay on `@anthropic-ai/sdk`
  untouched. Two Anthropic clients in one Worker is fine; migrating working analysis code to the
  AI SDK is exactly the rewrite this project forbids.
- Rejected alternative: hand-rolled SSE + custom React chat. More code, worse a11y, no
  retry/edit/attachment UX, and it re-implements what assistant-ui ships.

## Terminal — DECIDED: @xterm/xterm as renderer, introspection fixture as grammar

- `@xterm/xterm` ^5.5 (MIT, actively maintained; the old `xterm` package name is deprecated).
  Addons: `@xterm/addon-fit` (resize) only. No attach/pty addons — there is no shell.
- The command **grammar** is `fixtures/cli-introspection.json` — already CI-gated against the real
  CLI (staleness check, invariant I3 usage === --help). The browser terminal imports it at build
  time; command paths, flags, summaries, usage text all render from it. A hand-written binding
  table maps *supported* command paths to existing web API client calls; a parity test fails the
  build if a binding references a path/flag the fixture doesn't contain.
- Rejected alternative: running commander itself in the browser. Its action handlers import
  `node:fs` and `process`; stripping that is more code than a parser for a 21-command grammar with
  a machine-readable definition.

## Not adopted anywhere

- No Next.js, no react-router, no Tailwind/shadcn, no TanStack Query, no state-management library,
  no WebContainers, no vector store. The app is small; existing patterns (hash routing, `fetch`
  wrappers in `api.ts`, copy via `t()`) extend cleanly.
