# Verfix Roadmap

**Goal:** Be the trust layer between an AI coding agent's claim of "done" and your users — the same flow, authored once, is replayed deterministically at three moments: in the agent's edit→verify loop, at the PR gate, and against the deployed app. Typed failures close the agent's fix loop without a human; the PR comment and post-deploy result tell humans it worked without them clicking through the app. (Expanded, with the metric and the definition of "best in field," in [NORTH_STAR.md](./NORTH_STAR.md).)

**Where we are:** local-first runtime works end-to-end (in-process engine, typed failures, traces, source guard); `verfix` 0.3.7 / `@verfix/engine` 0.1.5 are on npm. The engine supports 12 actions (incl. form interaction, upload, iframe targeting, auth state reuse) and 8 failure types. Two independent coding-agent field reviews exist (a live SaaS app, and the-internet testbed — see the backlogs below); the second one recommends Verfix as the agent trust layer. We still have ~zero users. Everything below is ordered by what gets us from "works" to "used," and every phase has an explicit exit condition so we don't polish forever.

**Operating principle:** deterministic first, one config surface, frozen failure taxonomy. Capability grows by adding *steps and assertion detail inside the existing JSON schema* — never by adding a second config format, a plugin system, or a new mode.

---

## Phase 1 — Ship and dogfood (now → ~2 weeks)

*Why first: an unreleased tool has no users by definition, and a verification tool that doesn't verify its own project is not credible.*

- [x] Publish the pending release (`verfix` CLI + `@verfix/engine`) to npm; README quickstart must work in a clean directory in under 5 minutes.
- [x] Dogfood: `testbed/` (zero-dep app + `verfix.config.json` exercising the Phase 2 step surface) runs in this repo's CI (`.github/workflows/ci.yml`) alongside every package test suite and the JSON-purity guard; this also un-broke the smoke test CLAUDE.md/CONTRIBUTING document. Flows for the dashboard itself stay deferred with server mode. Every gap we hit becomes a Phase 2 item — this is how the backlog gets prioritized instead of guessed.
- [x] Delete/park drift: docs or code that describe the old hybrid worker mode, `@verifyruntime` scope, or aspirational features (LangGraph wrappers, WebSockets, cross-browser) that we are not building yet. → [#64](https://github.com/verfix-dev/verfix/issues/64)

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

**Exit condition:** we can write flows for 3 real open-source webapps (e.g. a Next.js SaaS starter, a Vite SPA, an admin dashboard) without hitting a missing action. → [#71](https://github.com/verfix-dev/verfix/issues/71)

## Phase 3 — Deepen the agent contract (parallel with Phase 2, ongoing)

*Why: this is the moat. Determinism and JSON config are copyable; a failure payload that reliably closes an agent's edit→verify loop is not. It also compounds — every Phase 2 action ships with its failure detail as part of the definition of done.*

- [ ] Richer failure `details`: DOM snippet around the failed selector, closest-matching selectors (computed deterministically — text/role similarity, no LLM), first console error, failing network request. → selector pieces: [#65](https://github.com/verfix-dev/verfix/issues/65); console/network correlation: the failure-synthesis track, [#63](https://github.com/verfix-dev/verfix/issues/63)
- [ ] Measure the moat: a testbed of deliberately-broken apps + a harness that runs a coding agent against each failure and records whether the loop closes without human help. This number ("loop-closure rate") is the product metric; fix_hint changes are judged by whether it moves. → [#66](https://github.com/verfix-dev/verfix/issues/66)
- [ ] Source guard hardening: it's the feature nobody else has — make sure it survives real agent behavior (partial commits, formatter runs, config edits) without false positives. → [#67](https://github.com/verfix-dev/verfix/issues/67)

**Exit condition:** loop-closure rate measured and improving release over release.

## Field-review backlog — first real-world SaaS run (July 2026)

*Source: a coding agent ran Verfix end-to-end against a live SaaS app (multi-outcome auth flow, real SPA noise). What worked: `optional` steps, `acceptStatuses`, `clearState`, config-first discipline. What follows is every friction point it hit, triaged. The theme across all of them: each one is a place where the agent had to **leave the structured contract** — spelunking in `.verfix/runs/` with a throwaway script, burning three run-iterations to discover console noise, deleting an assertion it couldn't scope. These fixes feed Phase 2's exit condition (real-app flows without gaps) and Phase 3's moat (loop-closure rate).*

### Tier 1 — quick wins (small, additive, no contract breaks; ship with Phase 2)

- [x] **Scoped `text_visible`.** Real pages repeat text ("Total Declarations" as both a card title and a caption); `text_visible` only takes a global `value`, so an ambiguous match forces the user to *delete* the assertion — the tool pushing toward weaker verification. Fix: `Assertion` in `workers/src/assertions/types.ts` already has `selector?`; make `text_visible` honor it in `workers/src/assertions/engine.ts` via `page.locator(selector).getByText(text)` when present. Backward compatible, ~10 lines + testbed flow. *Why it matters: strict mode is only viable if real-world assertions stay expressible without AI.*
- [x] **`verfix show <id> --console` / `--network`.** The reviewer's #1 time-saver. The data already exists — `workers/src/artifacts/collector.ts` writes `<id>_console.json` and `<id>_network.json` next to every trace — but the only way to read it today is a throwaway Node script against `.verfix/runs/`. Fix: pure CLI surface on the existing `show` command (newest run when no id, pretty + `--output json`), reusing the trace-resolution helpers in `cli/src/local-runner.ts`. *Why it matters: artifacts an agent can only reach by guessing file paths aren't part of the product.*
- [x] **AI rate-limit circuit breaker.** Under persistent 429s (observed: Gemini on every single call), all four adapters in `workers/src/ai/adapters/` warn and retry independently on every step — the deterministic fallback works, but the run pays the retry latency and log spam each time, and the degradation is invisible in the result. Fix: per-run state threaded through healing + post-failure analysis; after 2–3 consecutive 429s, disable AI for the remainder of the run and log once ("AI disabled for this run: persistent rate limiting; continuing deterministic"). *Why it matters: silent degradation is the design; silent + slow + noisy is not.*
- [x] **Quiet JSON output.** `--output json` dumps the full event timeline (every screenshot path, every DOM-snapshot path) even when the consumer only wants pass/fail + failures. Fix: additive `--quiet` flag on `run` emitting only the stable contract fields (`passed`, `failures[]`, `fix_hint`, `timeline_url`, `trace_path`, `show_command`). Default unchanged — no contract break; guard with `cli/test/json-purity.sh`. *Why it matters: the JSON consumer is an agent paying per token; timeline detail is pull-when-needed (via `show --console/--network`), not push-every-run.*

### Tier 2 — `verfix probe` (selector dry-run; medium effort)

- [x] Every selector fix today costs a full ~20s run (navigate → login → dashboard) just to learn whether one CSS selector resolves. v1: `verfix probe --selector "..."` / `--text "..."` loads the **last run's DOM snapshot** (already saved as `<id>.html` by `collector.ts`) into headless Chromium via `page.setContent()` and reports match count + outerHTML excerpts. Turns the config-first fix loop from ~20s into ~1s using artifacts we already collect. Documented caveat: the snapshot is end-of-run/at-failure state, not per-step — fine for the dominant case (fixing the selector that just failed); per-step probing waits for user pull. *Why it matters: the config-first rule is only tolerable if the config-fix loop is fast — this is the single biggest loop-time reduction available.*

### Tier 3 — `no_console_errors` noise (design decision, not just code)

Real SPAs fire unrelated transient errors on every run (branding fetch, session-validate, language-detect racing navigation). The reviewer burned three run-iterations discovering them one failure at a time, because the failure summary truncates to the first error string. The tempting fix — a built-in "ignore transient errors" default — is rejected: a default that swallows 401s can mask the exact regression a login flow exists to catch.

- [x] **Do now (deterministic, zero risk):** make *one* failing run sufficient to write the excludes. The engine already collects every error string in `details.errors` (`workers/src/assertions/engine.ts`); surface the full deduped list in CLI output, and upgrade the `no_console_errors` template in `workers/src/assertions/failure-hints.ts` to emit ready-to-paste suggested `exclude` regexes derived from the actual errors. Collapses the three-iteration discovery loop into one.
  *(Shipped with field-review #2's suggested-excludes item below — `details.suggested_exclude` + ready-to-paste `fix_hint`.)*
- [ ] **Discuss before building:** opt-in per-assertion `ignoreTransientNetworkErrors: true` (drops `Failed to fetch` / `net::ERR_*`-class errors that raced navigation). Failure behavior and `fix_hint` semantics are agent-facing contract, so this goes through a GitHub Discussion first, per existing policy.

### Declined

- **Built-in noise-ignoring default for `no_console_errors`** — see Tier 3; deterministic-first says make the exclude loop fast, not silently swallow errors.
- **Anything about the target app's missing `data-testid`s** — not Verfix's bug. One cheap action: a line in `generateAgentsSection()` guidance noting that when the agent owns the app source (outside a verify-fix loop), adding `data-testid`s is the durable fix for selector brittleness.
- **New failure types** — nothing above needs one; the taxonomy stays frozen.

## Field-review backlog #2 — the-internet testbed run (July 2026)

*Source: a second coding agent bootstrapped Verfix from scratch (`init --yes` → wrote flows from the app's real ERB source → all three flows green) against the-internet.herokuapp.com, then reviewed it. Its verdict: recommend Verfix as the agent trust layer ("prove it before you call it done"), with maturity caveats. Every claim was verified against the current code before triage — and three of its seven issues turned out to be version skew or already-shipped features. That is itself the headline finding: **discoverability and version skew now cost adoption more than missing features do.***

### Confirmed — do first

- [x] **Step-level selector misses are misclassified as `timeout` with the wrong fix_hint.** Found dogfooding the testbed: a `type` step whose selector doesn't exist (`#user-name` vs `#username`) fails via `locator.waitFor: Timeout 15000ms exceeded` and is reported as `type: "timeout"` with hint "Increase timeout or wait for network/DOM to settle" — the one action guaranteed not to fix a drifted selector. An agent pattern-matching the taxonomy is steered *away* from the real fix, which is precisely the loop-closure failure the taxonomy exists to prevent. Fix: when a step's locator wait times out, classify as `selector_not_found` (the taxonomy already has it) with the selector in `details`; keep `timeout` for genuine waits (`wait_for_url`, network idle, navigation). Also strip ANSI escape codes from Playwright call logs before embedding them in JSON `detail` — agents pay tokens for `[2m` noise.

- [x] **Console/network error entries omit the source URL.** `page.on('console')` in `workers/src/engine.ts` recorded only type/text/timestamp — `msg.location()` was dropped, making a precise `exclude` guesswork (the reviewing agent ended up with `exclude: ["404"]`, which would mask exactly the regression a login flow exists to catch). Fixed: `ConsoleLine` now carries `source_url`/`line`; `no_console_errors` failure `details` gains `source_url` and a `third_party` flag (origin compared against `page.url()`) so agents can tell "your bug" from "vendor script noise" without reading raw console logs. Paired with the next item.
- [x] **Suggested `exclude` patterns from one failing run** — was Tier 3's "do now" above; a second independent review hit the identical three-iteration discovery loop and produced the predicted over-broad exclude. Fixed: `no_console_errors` failures now carry `details.suggested_exclude` (the error text, regex-escaped) and `fix_hint` embeds it as a ready-to-paste `"exclude": [...]` line, plus the third-party note from the item above. The CLI/SDK `failures[]` JSON gained an additive `source_url` field.
- [x] **Version-skew warning in `doctor`.** Two of the seven reported issues (a `text_visible` strict-mode violation, an init→status "config not found" race) do not exist in the current code — the reviewer's global `verfix` binary was stale while `npx verfix` was current, so it debugged phantom bugs and filed them as product feedback. Fixed: `doctor` now runs a live version check (not the 24h-throttled background cache, which may not have populated yet on a fresh install) and reports the installed version, whether it's current, and the resolved path of the binary actually executing — the path is what actually exposes a global/npx split, since the version number alone didn't.
- [ ] **Teach the generated instructions what already exists.** → [#68](https://github.com/verfix-dev/verfix/issues/68) The agent read `AGENTS.md` and `.verfix/INSTRUCTIONS.md` and still wished for three features that already shipped: per-step screenshots (every trace records them — `verfix show`), non-interactive run data (`show --console/--network --output json`), and scoped `text_visible` (the `selector` field, shipped in the Phase 2 release). The contract only counts if agents discover it: update `generateAgentsSection()` to cover these, plus one line stating that selectors are full Playwright selector syntax (CSS, `:has-text()`, `text=`, `role=`) — also the answer to "document which selector engines are supported."

### Confirmed — small and additive

- [ ] **`selector_count` assertion.** → [#69](https://github.com/verfix-dev/verfix/issues/69) "Exactly N items exist" is real verification surface for dynamic lists (the add/remove-elements flow could only assert visibility, not count). Additive assertion type mapping onto the existing failure taxonomy (`selector_not_found` when 0 found, `assertion_failed` on count mismatch) — no new failure types, so no Discussion needed.
- [ ] **`--base-url` alias on `run`.** → [#70](https://github.com/verfix-dev/verfix/issues/70) `init` says `--base-url`, `run` says `--url`; the inconsistency tripped the agent. Keep `--url`, add the alias — additive, no contract break.

### Stale or already shipped (no code action; covered by the discoverability item)

- `text_visible` multi-match strict violation — fixed in 5c2c132 (scoped `selector` support + pass-if-any-visible-match semantics); the reviewer ran an older binary.
- init→status race — not reproducible in current code (config detection is a synchronous fs read); same stale-global-binary suspect.
- "`--show-browser` silently falls back without a display" — the human operator watched the browser window during the run; there was a display. No fallback exists to warn about.

### Declined

- **Selector linter against source files in `validate`** — framework-specific (ERB/JSX/Vue/Svelte/…), brittle against build-time class mangling, and `verfix probe` already answers "does this selector resolve" in ~1s against the last run's *real* DOM. A source linter would be a second, worse source of truth.
- **Per-flow `baseUrl` override** — a flow library describes one app. For the rare cross-origin hop, `navigate` steps already accept absolute URLs (`resolveNavigateUrl` passes any `scheme:` URL through untouched). Wait for user pull.
- **Built-in "third-party/favicon" console-error category** — same call as Tier 3: a default that silently swallows error classes is how a flow misses a real failure. Make excludes precise (URL capture) and cheap (suggested excludes) instead.

## Field-review backlog #3 — rotating-token SaaS run (July 2026)

*Source: a third coding agent ran Verfix against an app whose backend rotates (single-use) refresh tokens — the hardest real-world case for auth state reuse. What worked: `${RANDOM}`/`${TIMESTAMP}` macros, trace/HAR forensics via `show --console/--network`. Both real pain points were state-lifecycle assumptions: restore timing wasn't scoped to the flow that declared it, and a restored-but-rotated session failed as a bare `selector_not_found` three network requests away from its root cause. One claim was verified false before triage: "AI is attempted on steps with zero self-healing need" — healing only fires after exact + semantic resolution both fail (`workers/src/ai/self-healing.ts`).*

### Confirmed — fixed (branch `feat/state-lifecycle`)

- [x] **`useState` restored run-wide instead of per-flow.** Restore happened once at browser-context creation, before any flow — so a `clearState` flow batched ahead of a `useState` flow booted with a session it explicitly asked not to have, and only one state name per run worked. Fixed: each flow's declared `useState` is seeded immediately before that flow runs (`workers/src/browser/storage-state.ts`: cookies via `addCookies`, web storage via a routed blank page on the saved origin), making every flow's `clearState → steps → saveState` lifecycle self-contained; multiple state names per run now work. Fast path kept: when the run's *first* flow declares `useState`, the state still applies at context creation — the only path that can restore IndexedDB (Firebase/MSAL token caches). Regression test: `workers/test/engine/state-lifecycle.test.ts` (`npm run test:state`), which runs a real rotating-token mini-app.
- [x] **Single-use (rotating) refresh tokens made saved state stale after one restore.** Only the `saveState`-owning flow ever wrote the file, so after the first restore consumed the token, every later run replayed a dead session. Fixed deterministically — no detection heuristics needed for the common path: after a flow that restored a state passes, the live (post-rotation) session is re-captured to the same name (`refreshState`, default `true`; set `false` on a flow that ends logged out). Escape hatch for known-bad state: `verfix run --fresh-state` discards the selected flows' saved states so login flows re-authenticate from scratch.

### Confirmed — open, sized for an independent implementer

Hints below encode decisions already made — don't re-litigate them. Every task ends with `(cd cli && npx tsc --noEmit) && (cd workers && npx tsc --noEmit --skipLibCheck)` plus the named tests.

- [x] **Clamp AI call time to the remaining per-run budget; fix the breaker message.** Each AI HTTP call has a 30s timeout (`workers/src/ai/adapters/_http.ts`, `DEFAULT_TIMEOUT_MS`) but the per-run budget is 20s (`workers/src/ai/circuit-breaker.ts`, `AI_TIME_BUDGET_MS`), so one slow call spends 30s of a 20s budget and yields the nonsensical "AI time budget exhausted (30s spent of 20s…)". Fix: (1) export `remainingAIBudgetMs()` from `circuit-breaker.ts`; (2) in `provider.ts#chatCompletion`, short-circuit to `null` (same as an open breaker) when under ~2s remain, otherwise thread `Math.min(30000, remainingAIBudgetMs())` through the adapter interface (`workers/src/ai/adapters/types.ts`) down to `fetchWithTimeout`; (3) reword the message to "AI time budget exhausted (Xs spent, budget Ys — set AI_TIME_BUDGET_MS to allow more)". Don't change retry semantics, thresholds, or the env override. Extend `workers/test/ai/circuit-breaker.test.ts` (`npm run test:circuit-breaker`): budget-exceeding outcome ⇒ remaining is 0 and breaker open; `resetAIBreaker()` ⇒ full budget again.
- [x] **Stale/rejected restored-session detection in fix hints.** Still reachable after `refreshState: false`, expiry, or server-side logout: the app 401s on its refresh call, redirects to login, and the flow fails as a bare `selector_not_found`. Fix (deterministic, no AI, no new failure `type` — taxonomy frozen): the engine's flow loop already has `stateRestored` and `networkRequests` (`url`/`status`/`timestamp`); pass a `stateRestored` boolean into `runAssertions` (`workers/src/assertions/engine.ts` — note it's called from three places in `engine.ts`; only the flow-level call passes `true`). Where `fix_hint` renders (~line 206): if failure type is `selector_not_found` / `selector_not_visible` / `url_mismatch` / `timeout` AND `stateRestored` AND a captured request has status 401/403 with URL matching `/(auth|token|refresh|session|login|oauth|signin)/i`, append: "Note: a saved session state was restored for this flow and the server returned <status> on <method> <path> — the saved state may be stale or single-use. Re-run the flow that saves it, or run with --fresh-state." Put the helper in `failure-hints.ts` (e.g. `appendStaleStateHint`), truncate the URL to its path (tokens live in query strings), and add a standalone test script with a synthetic 401-on-`/api/auth/refresh` network array (hint appears) and negative cases (no restore / no auth-ish 4xx ⇒ no hint); register it in `workers/package.json`. Appending hint text is contract-safe; renaming fields or `type` strings is not.
- [x] **`verfix show --network`: `--filter` + anomaly summary.** All in `cli/src/index.ts` (`show` command, ~lines 1784–1840, artifacts read via `readArtifact('_network.json', ...)` with `url`/`method`/`status`/`timing_ms`/`timestamp` entries). (1) `--filter <pattern>`: case-insensitive substring match on URL (plain string, not regex — shell footguns), applied to both `--console` and `--network`, pretty and json. (2) Pretty `--network` prints an anomaly summary first: requests with `status >= 400` or `status === 0` under a "⚠ N failed request(s):" header, then the full filtered list. (3) JSON stays additive: filtering narrows arrays; add a `failed_requests` array alongside `network_requests` — never restructure existing fields, and keep stdout pure JSON (notices to stderr). Update the `show` docs (grep `--network` in `docs/`) and `cli/src/agents-md.ts` where show flags are described. Smoke: run the testbed login flow, then `npx ts-node src/index.ts show --network --filter auth`.

### Declined

- **New failure taxonomy type for stale sessions** — taxonomy changes require a GitHub Discussion; the enriched `fix_hint` above covers it.
- **`verfix validate` warning for batching `clearState` + `useState` flows** — the ordering bug it would have flagged is fixed; the combination is now valid and useful.
- **Skip AI healing "when the previous run matched deterministically"** — healing already only fires after exact + semantic resolution both fail; cross-run memory adds state for no gain. The real cost was the budget/timeout mismatch, fixed above.

## Field-review backlog #4 — evidence synthesis (July 2026)

*Source: a fourth coding-agent review, after diagnosing two failures (occluding onboarding dialog reported as a bare `selector_not_found`; an early `Failed to fetch` console error never connected to a later selector failure) by hand-grepping raw artifacts. Its verdict: "Verfix did the capture work correctly — the gap is entirely in synthesis. Both issues were 'the evidence was in the trace the whole time,' not 'the evidence was missing.'" Since failure causes are open-ended, the response is architectural, not per-cause: a universal evidence surface (cause-agnostic failure-time facts, `show --timeline`/`--dom` queries, a diagnosis playbook in the generated instructions) plus a deterministic analyzer pipeline emitting additive `findings[]` for recurring causes. Tracked in [#63](https://github.com/verfix-dev/verfix/issues/63) (work items #55–#61). Feeds the same Phase 3 moat as the richer-`details` item above.*

## Phase 4 — GitHub Action: from tool to gate (~1 month, after Phase 2 exit)

Tracked in [#72](https://github.com/verfix-dev/verfix/issues/72).

*Why: this is the moment Verfix becomes infrastructure, and the moment it starts solving the original pain point end-to-end: after an agent's change is raised as a PR — and after it deploys — no human should have to open a browser to learn whether it worked. The same `verfix.config.json` the agent used locally gates the PR and smoke-tests the deployment — that's the portability story made visible.*

- [ ] Composite GitHub Action: install CLI, cache Chromium, run flows, upload trace zips as artifacts.
- [ ] PR comment: pass/fail per flow, typed failure list with fix_hints, screenshot of the failure point. This comment *is* the human-facing product — a reviewer should be able to trust a green comment instead of manually clicking through the app.
- [ ] Preview-deploy verification: the base-URL input accepts the PR's preview deployment URL (Vercel/Netlify/custom), so flows run against the *deployed* change, not just a local build. The engine already supports this today (`verfix run --url <deployed-url>` — field review #2 ran against a live Heroku app); this is wiring, not engine work.
- [ ] Post-deploy smoke: document (and ship an example workflow for) running the same flows on `deployment_status`/post-merge against staging or production — the "did it actually work for users" check. Notifications beyond CI status (Slack, dashboards, scheduled re-runs) belong to the future hosted product, not this phase.
- [ ] Zero new config: the action reads the existing `verfix.config.json`. If it needs its own YAML beyond `uses:` + a base-URL input, we've failed.

**Exit condition:** Verfix's own repo is gated by the action, a PR's flows run against its preview deployment, and the PR comment is good enough to screenshot for the launch post.

## Phase 5 — Distribution (starts the day Phase 1 ships, never stops)

*Why: with zero users, adoption is a bigger risk than any missing feature. Verfix's natural audience lives in the coding-agent ecosystem — go where they are instead of waiting.*

- [ ] Framework-aware `verfix init`: detect Next.js/Vite, scaffold a working flow against the dev server, so first success takes minutes. → [#73](https://github.com/verfix-dev/verfix/issues/73)
- [ ] First-class Claude Code / Cursor integration: the AGENTS.md stub already exists — package Verfix as a Claude Code plugin/skill and/or MCP server so agents can adopt it without the human wiring anything. → [#74](https://github.com/verfix-dev/verfix/issues/74)
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
