# Verfix Roadmap

**Goal:** Be the deterministic verification layer between AI-generated code and production — the gate every automated change passes through before it reaches users.

**Where we are:** local-first runtime works end-to-end (in-process engine, typed failures, traces, source guard). The engine supports 12 actions (incl. form interaction, upload, iframe targeting, auth state reuse) and 8 failure types. We have zero users. Everything below is ordered by what gets us from "works" to "used," and every phase has an explicit exit condition so we don't polish forever.

**Operating principle:** deterministic first, one config surface, frozen failure taxonomy. Capability grows by adding *steps and assertion detail inside the existing JSON schema* — never by adding a second config format, a plugin system, or a new mode.

---

## Phase 1 — Ship and dogfood (now → ~2 weeks)

*Why first: an unreleased tool has no users by definition, and a verification tool that doesn't verify its own project is not credible.*

- [ ] Publish the pending release (`verfix` CLI + `@verfix/engine`) to npm; README quickstart must work in a clean directory in under 5 minutes.
- [ ] Dogfood: add `verfix.config.json` flows for the Verfix dashboard itself and run them in this repo's CI. Every gap we hit becomes a Phase 2 item — this is how the backlog gets prioritized instead of guessed.
- [ ] Delete/park drift: docs or code that describe the old hybrid worker mode, `@verifyruntime` scope, or aspirational features (LangGraph wrappers, WebSockets, cross-browser) that we are not building yet.

**Exit condition:** a stranger can `npx verfix init && verfix run` successfully from the README alone.

## Phase 2 — Enough surface to verify a real app (~1–2 months)

*Why: the original 5 actions could not express most real flows. This was the single biggest blocker to anyone adopting. But "surface" means the top 80% of flows — not Playwright parity.*

Actions (each lands in the same step schema, each maps failures onto the *existing* taxonomy, each gets a testbed flow):

- [x] `select_option`, `check` / `uncheck`, `hover`
- [x] `upload_file`
- [x] iframe targeting (a `frame` field on steps, not a new step type)
- [x] `wait_for_url` / wait for network idle
- [x] Auth state reuse (save/restore storage state) — without this, every flow re-implements login and people give up

Assertions: **no new failure types.** Richness goes into the failure payload (see Phase 3), not the taxonomy. New types require a GitHub Discussion, per existing policy.

**Exit condition:** we can write flows for 3 real open-source webapps (e.g. a Next.js SaaS starter, a Vite SPA, an admin dashboard) without hitting a missing action.

## Phase 3 — Deepen the agent contract (parallel with Phase 2, ongoing)

*Why: this is the moat. Determinism and JSON config are copyable; a failure payload that reliably closes an agent's edit→verify loop is not. It also compounds — every Phase 2 action ships with its failure detail as part of the definition of done.*

- [ ] Richer failure `details`: DOM snippet around the failed selector, closest-matching selectors (computed deterministically — text/role similarity, no LLM), first console error, failing network request.
- [ ] Measure the moat: a testbed of deliberately-broken apps + a harness that runs a coding agent against each failure and records whether the loop closes without human help. This number ("loop-closure rate") is the product metric; fix_hint changes are judged by whether it moves.
- [ ] Source guard hardening: it's the feature nobody else has — make sure it survives real agent behavior (partial commits, formatter runs, config edits) without false positives.

**Exit condition:** loop-closure rate measured and improving release over release.

## Field-review backlog — first real-world SaaS run (July 2026)

*Source: a coding agent ran Verfix end-to-end against a live SaaS app (multi-outcome auth flow, real SPA noise). What worked: `optional` steps, `acceptStatuses`, `clearState`, config-first discipline. What follows is every friction point it hit, triaged. The theme across all of them: each one is a place where the agent had to **leave the structured contract** — spelunking in `.verfix/runs/` with a throwaway script, burning three run-iterations to discover console noise, deleting an assertion it couldn't scope. These fixes feed Phase 2's exit condition (real-app flows without gaps) and Phase 3's moat (loop-closure rate).*

### Tier 1 — quick wins (small, additive, no contract breaks; ship with Phase 2)

- [x] **Scoped `text_visible`.** Real pages repeat text ("Total Declarations" as both a card title and a caption); `text_visible` only takes a global `value`, so an ambiguous match forces the user to *delete* the assertion — the tool pushing toward weaker verification. Fix: `Assertion` in `workers/src/assertions/types.ts` already has `selector?`; make `text_visible` honor it in `workers/src/assertions/engine.ts` via `page.locator(selector).getByText(text)` when present. Backward compatible, ~10 lines + testbed flow. *Why it matters: strict mode is only viable if real-world assertions stay expressible without AI.*
- [x] **`verfix show <id> --console` / `--network`.** The reviewer's #1 time-saver. The data already exists — `workers/src/artifacts/collector.ts` writes `<id>_console.json` and `<id>_network.json` next to every trace — but the only way to read it today is a throwaway Node script against `.verfix/runs/`. Fix: pure CLI surface on the existing `show` command (newest run when no id, pretty + `--output json`), reusing the trace-resolution helpers in `cli/src/local-runner.ts`. *Why it matters: artifacts an agent can only reach by guessing file paths aren't part of the product.*
- [x] **AI rate-limit circuit breaker.** Under persistent 429s (observed: Gemini on every single call), all four adapters in `workers/src/ai/adapters/` warn and retry independently on every step — the deterministic fallback works, but the run pays the retry latency and log spam each time, and the degradation is invisible in the result. Fix: per-run state threaded through healing + post-failure analysis; after 2–3 consecutive 429s, disable AI for the remainder of the run and log once ("AI disabled for this run: persistent rate limiting; continuing deterministic"). *Why it matters: silent degradation is the design; silent + slow + noisy is not.*
- [x] **Quiet JSON output.** `--output json` dumps the full event timeline (every screenshot path, every DOM-snapshot path) even when the consumer only wants pass/fail + failures. Fix: additive `--quiet` flag on `run` emitting only the stable contract fields (`passed`, `failures[]`, `fix_hint`, `timeline_url`, `trace_path`, `show_command`). Default unchanged — no contract break; guard with `cli/test/json-purity.sh`. *Why it matters: the JSON consumer is an agent paying per token; timeline detail is pull-when-needed (via `show --console/--network`), not push-every-run.*

### Tier 2 — `verfix probe` (selector dry-run; medium effort)

- [ ] Every selector fix today costs a full ~20s run (navigate → login → dashboard) just to learn whether one CSS selector resolves. v1: `verfix probe --selector "..."` / `--text "..."` loads the **last run's DOM snapshot** (already saved as `<id>.html` by `collector.ts`) into headless Chromium via `page.setContent()` and reports match count + outerHTML excerpts. Turns the config-first fix loop from ~20s into ~1s using artifacts we already collect. Documented caveat: the snapshot is end-of-run/at-failure state, not per-step — fine for the dominant case (fixing the selector that just failed); per-step probing waits for user pull. *Why it matters: the config-first rule is only tolerable if the config-fix loop is fast — this is the single biggest loop-time reduction available.*

### Tier 3 — `no_console_errors` noise (design decision, not just code)

Real SPAs fire unrelated transient errors on every run (branding fetch, session-validate, language-detect racing navigation). The reviewer burned three run-iterations discovering them one failure at a time, because the failure summary truncates to the first error string. The tempting fix — a built-in "ignore transient errors" default — is rejected: a default that swallows 401s can mask the exact regression a login flow exists to catch.

- [ ] **Do now (deterministic, zero risk):** make *one* failing run sufficient to write the excludes. The engine already collects every error string in `details.errors` (`workers/src/assertions/engine.ts`); surface the full deduped list in CLI output, and upgrade the `no_console_errors` template in `workers/src/assertions/failure-hints.ts` to emit ready-to-paste suggested `exclude` regexes derived from the actual errors. Collapses the three-iteration discovery loop into one.
- [ ] **Discuss before building:** opt-in per-assertion `ignoreTransientNetworkErrors: true` (drops `Failed to fetch` / `net::ERR_*`-class errors that raced navigation). Failure behavior and `fix_hint` semantics are agent-facing contract, so this goes through a GitHub Discussion first, per existing policy.

### Declined

- **Built-in noise-ignoring default for `no_console_errors`** — see Tier 3; deterministic-first says make the exclude loop fast, not silently swallow errors.
- **Anything about the target app's missing `data-testid`s** — not Verfix's bug. One cheap action: a line in `generateAgentsSection()` guidance noting that when the agent owns the app source (outside a verify-fix loop), adding `data-testid`s is the durable fix for selector brittleness.
- **New failure types** — nothing above needs one; the taxonomy stays frozen.

## Phase 4 — GitHub Action: from tool to gate (~1 month, after Phase 2 exit)

*Why: this is the moment Verfix becomes infrastructure. The same `verfix.config.json` the agent used locally gates the PR — that's the portability story made visible.*

- [ ] Composite GitHub Action: install CLI, cache Chromium, run flows, upload trace zips as artifacts.
- [ ] PR comment: pass/fail per flow, typed failure list with fix_hints, screenshot of the failure point.
- [ ] Zero new config: the action reads the existing `verfix.config.json`. If it needs its own YAML beyond `uses:` + a base-URL input, we've failed.

**Exit condition:** Verfix's own repo is gated by the action, and the PR comment is good enough to screenshot for the launch post.

## Phase 5 — Distribution (starts the day Phase 1 ships, never stops)

*Why: with zero users, adoption is a bigger risk than any missing feature. Verfix's natural audience lives in the coding-agent ecosystem — go where they are instead of waiting.*

- [ ] Framework-aware `verfix init`: detect Next.js/Vite, scaffold a working flow against the dev server, so first success takes minutes.
- [ ] First-class Claude Code / Cursor integration: the AGENTS.md stub already exists — package Verfix as a Claude Code plugin/skill and/or MCP server so agents can adopt it without the human wiring anything.
- [ ] Launch: Show HN + posts in agent-tooling communities, anchored on a real demo ("my agent broke the app, Verfix caught it, the agent fixed it — no human").
- [ ] Talk to every early user personally; their init failures are the top of the backlog.

## Explicit non-goals (until users pull for them)

These are cut not because they're bad, but because each one doubles a maintenance surface while we have zero users:

- **Hosted runners / server mode investment** — server mode is frozen: kept compiling, not extended. It's a future product; today it's the largest complexity liability in the repo (Docker networking, Redis, Postgres, dashboard).
- **Cross-browser (WebKit/Firefox)** — Chromium covers the verification use case; this is test-tool feature creep.
- **Plugin system / custom assertions API** — a plugin API freezes internals before we know what they should be.
- **More AI modes** — assisted/exploratory exist as fallbacks; the pitch is deterministic and free. AI investment waits for evidence users want it.
- **Real-time streaming, WebSockets, execution diffing** — observability polish for a dashboard nobody uses yet.

## How Verfix grows capability without losing its edge

1. **One schema.** Every capability is a step field or assertion field in `verfix.config.json`. The day there are two ways to configure Verfix, portability — a core moat — is dead.
2. **Frozen taxonomy, rich details.** Agents pattern-match on 8 stable type strings; depth goes into `details` and `fix_hint`, which can grow freely without breaking anyone.
3. **Local-first invariant.** No feature may require Docker, an API key, or a network service in the default path.
4. **Definition of done = testbed flow + failure detail.** An action without a flow exercising it and a designed failure payload isn't done.
5. **Deletion over addition.** Before each phase, remove something (dead mode, stale doc, unused flag).
