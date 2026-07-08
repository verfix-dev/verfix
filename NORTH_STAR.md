# Verfix North Star

*Derived 2026-07-08 from a full repo + market review. Companion to [ROADMAP.md](./ROADMAP.md)
(the how); this is the what and the why-us. Re-review quarterly; delete sections that stop being true.*

---

## The goal, in one sentence

> **Verfix is the verification gate every AI-generated change passes on its way to users:**
> agents author a flow once, then it is replayed deterministically — in the agent's
> edit→verify loop, at the PR gate, and against the deployed app — for zero tokens, with
> typed failures that close the agent's fix loop and results humans can trust without
> opening a browser themselves.

"Best in its field" therefore does **not** mean best browser automation, best test framework,
or best AI agent. Those fields have entrenched winners (Playwright, Stagehand, browser-use).
Verfix's field is one layer up and currently unoccupied: **the trust layer between an AI
coding agent's claim of "done" and the users the change ships to.** The pain it removes is
specific: today, when an agent's PR is raised, merged, or deployed, a human still has to
click through the app to know it worked. Win that layer.

## The one metric

**Loop-closure rate** — % of typed failures that a coding agent fixes without human help,
measured on a testbed of deliberately broken apps (ROADMAP Phase 3). Every feature, every
`fix_hint` edit, every failure-payload change is judged by whether it moves this number.

Supporting metrics: time-to-first-green-run (target < 5 min from `npx verfix init` in a
clean repo), and number of repos whose CI is gated by Verfix (starting with this one).

## Why Verfix wins this layer (the differentiation, honestly ranked)

1. **The source guard.** No other tool detects an agent editing application source to make
   its own check pass. Reward-hacking in coding agents is now a mainstream concern; Verfix
   has the only shipped, typed answer (`source_changes`, `warn`/`block`). This is the
   hardest thing on this list to copy, because it only exists if you take the verify loop
   seriously as a product.
2. **The frozen failure taxonomy + `fix_hint` contract.** 8 stable type strings agents
   pattern-match on, semver-guarded field names, depth in `details` not in new types.
   Interaction tools return prose; Verfix returns a contract.
3. **Zero-token deterministic replay, local-first.** Strict mode needs no key, no Docker,
   no network. Note: this pillar is *eroding* — Stagehand caches actions ("costs approach
   zero after the first run") and Playwright CLI cut MCP token usage ~4x. Determinism and
   the contract must carry more weight over time than raw token savings.
4. **One config, four contexts.** The same `verfix.config.json` runs in the agent's loop,
   on the developer's machine, as a GitHub Actions PR gate, and against the deployed app
   (preview or production URL — the engine already does this via `run --url`; Phase 4
   wires it up). Nobody else's artifact is portable across all four.

What is explicitly **not** a differentiator: exploratory mode (same technique as every
LLM-browser tool), breadth of browser actions (Playwright MCP has 40+; we cap at the top
80% of flows), cross-browser, and the dashboard.

## The five gaps between the claim and the repo (close in this order)

1. **Verfix does not verify Verfix.** No `verfix.config.json` in this repo, no `testbed/`
   (CONTRIBUTING and CLAUDE.md reference one that doesn't exist), and CI contains only a
   publish workflow — no tests, no verification run, no JSON-purity guard. For a trust
   product this is the credibility gap; a stranger who checks will conclude we don't
   believe our own pitch. *(ROADMAP Phase 1, still open.)*
2. **Docs that describe a product that doesn't exist.** `docs/6-resources/benchmarks.md`
   claims continuous benchmarking that isn't running; `docs/4-guides/hybrid-mode.md`
   documents a deleted mode; four Docker guides dominate the guides section for a frozen
   opt-in mode. Deterministic-first tools cannot have aspirational docs — delete or mark
   them. *(ROADMAP Phase 1 "delete drift", still open.)*
3. **The recommended workflow's middle step has no tooling.** Our own positioning doc says
   "explore once → **compile** into a flow → verify forever," but nothing compiles: an
   exploratory run throws its discovered steps away. Shipping `--emit-flow` (exploratory
   run prints a ready-to-paste flow config) makes authoring near-free and turns every
   competitor's exploration strength into our funnel. This is the adoption cliff: every
   rival is zero-authoring-cost; we ask for JSON up front.
4. **The moat is asserted, not measured.** Until the loop-closure harness exists and the
   number is published, "agents close the loop with Verfix" is marketing. Once published,
   it's a benchmark competitors have to answer. *(ROADMAP Phase 3.)*
5. **Zero distribution surface where agents live.** Vercel ships agent-browser as a Claude
   Code skill; Playwright MCP is one config line in every client. Verfix requires a human
   to install and init first. Package the existing AGENTS.md machinery as a Claude Code
   skill/plugin and a thin MCP server (expose `verfix_run`, `verfix_show`, `verfix_probe`
   as tools) so an agent can adopt Verfix mid-task. *(ROADMAP Phase 5.)*

## Definition of "best in field" (check yearly, all must hold)

- [ ] This repo's own CI is gated by `verfix run` on the dashboard + a testbed app.
- [ ] Published loop-closure rate, improving release over release.
- [ ] A stranger's agent can go from `npx verfix init` to a green gated PR in < 5 minutes
      without the human writing a flow by hand.
- [ ] `verfix.config.json` is recognized in agent-tooling discussions as the portable
      verification artifact (the thing you commit so the *next* agent doesn't re-explore).
- [ ] Source guard cited by name when people discuss agent reward-hacking mitigations.

## Standing constraints (from ROADMAP, restated because they are the brand)

One schema. Frozen taxonomy, rich details. Local-first invariant — no feature may require
Docker, an API key, or a network service in the default path. Deletion over addition.
Deterministic first: never reach for an LLM where a selector, assertion, or retry works.
