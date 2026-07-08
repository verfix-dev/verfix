# Verfix vs. Playwright MCP — An Honest Positioning Guide

> **TL;DR** — Playwright MCP lets an AI agent *drive* a browser. Verfix lets an AI
> agent *verify* its work in a browser, repeatably, for zero tokens. They solve
> different problems and are frequently complementary: explore once with an
> LLM-driven browser, then **compile that exploration into a deterministic Verfix
> flow** and re-run it hundreds of times for free. If your problem is "an agent
> needs to poke around a page it has never seen," use Playwright MCP. If your
> problem is "an agent keeps claiming the login page works when it doesn't," use
> Verfix.

---

## 1. What each tool actually is

### Playwright MCP

[Playwright MCP](https://github.com/microsoft/playwright-mcp) is Microsoft's
official Model Context Protocol server for Playwright. It exposes 40+ browser
tools (navigate, click, type, snapshot, network mocking, tracing, …) to any MCP
client — Claude Code, Cursor, VS Code, Windsurf, Claude Desktop. Instead of
screenshots, it feeds the LLM structured **accessibility snapshots** (~200–400
tokens per page state), and the LLM decides, action by action, what to do next.

It is an **interaction layer**: a very good pair of robotic hands and eyes for a
language model. The "program" is the LLM's reasoning loop — every step of every
run is an inference call.

### Verfix

Verfix is a **verification runtime**: deterministic browser flows defined in
`verfix.config.json`, typed assertions, structured JSON results, and a recorded
Playwright trace for every run. The "program" is the config file — the LLM is
not in the execution loop at all (in the default `strict` mode).

It is built for one specific moment: **the point in an AI coding loop where the
agent claims it's done and needs proof.** The agent runs
`verfix run --flow login --output json`, gets back `passed: true/false` with a
typed failure taxonomy and a `fix_hint`, and iterates.

These are different layers of the stack. Comparing them head-to-head is a bit
like comparing a keyboard to a test suite — but since agents can *ad-hoc verify*
things through Playwright MCP too, the comparison matters in practice. That's
what the rest of this document is about.

---

## 2. Head-to-head comparison

| Dimension | Playwright MCP | Verfix |
|---|---|---|
| **Core model** | LLM decides each action at run time | Config file defines flow; engine replays it deterministically |
| **Determinism** | None — same prompt can take different paths, reach different conclusions | Full — same config, same steps, same assertions, every run |
| **Token cost per verification** | Every run: per-action snapshots + reasoning (typically thousands to tens of thousands of tokens per flow) | **Zero** in strict mode. AI invoked only on selector failure in `assisted` mode |
| **Latency per verification** | Bottlenecked by LLM inference — often 30s–several minutes per flow | Playwright-native speed — typically seconds |
| **Result format** | Free-form text in the agent's context ("the login seems to work") | Stable JSON contract: `passed`, `failures[]` with one of 8 typed failure codes, `fix_hint`, trace path |
| **Failure diagnosis** | Whatever the LLM narrates | Typed taxonomy (`selector_not_found`, `text_mismatch`, `console_error`, `network_failure`, `url_mismatch`, `timeout`, …) that agents pattern-match on |
| **Repeatability / regression** | Re-verifying = re-paying full token + latency cost; results may differ | Re-run is free and identical; suitable for CI (`strict` mode needs no AI key at all) |
| **Audit trail** | Chat transcript | Playwright trace zip per run (screenshots, network, console) — `verfix show <id>` |
| **Self-deception risk** | High — the same model that wrote the code judges whether it works, and LLMs are agreeable graders of their own output | Low — assertions are exact; the model cannot talk its way past `expected "Welcome", got "500 Internal Server Error"` |
| **Guardrails on the fix loop** | None — agent may add `data-testid` to production source just to make its check pass | Source guard: typed `source_changes` signal, `warn`/`block` policy on project-source edits during a verify loop |
| **Unknown / never-seen pages** | Excellent — this is its home turf | Weak — needs a flow written first (`exploratory` mode exists but is the same LLM-driven approach, and is honestly not the reason to choose Verfix) |
| **Test generation** | Strong ecosystem (Playwright test agents: planner/generator/healer) | Flow authoring is manual or agent-written config |
| **Setup** | Add MCP server to client config | `npx verfix init` → config + Chromium; no Docker, no services |
| **Backing / ecosystem** | Microsoft, massive community, the default agentic-browser standard in 2026 | Independent, small |

---

## 3. The economics: why determinism wins the verify loop

An AI coding agent doesn't verify once. A typical feature involves an
**edit → verify → fix → verify** loop that runs the same flow 3–10 times, and a
project accumulates dozens of flows that should be re-checked on every change.

Rough math for one 8-step login flow, verified 5 times during one task:

- **Playwright MCP:** 8 actions × (snapshot ~300 tokens + reasoning output) × 5
  runs ≈ 15,000–50,000+ tokens and 3–10 minutes of wall-clock LLM time — *per
  task, per flow*. Multiply by every flow, every task, every day. And each run
  may take a slightly different path, so a "pass" on run 5 doesn't strictly
  confirm run 1's failure was fixed.
- **Verfix (strict):** 0 tokens, ~5–15 seconds per run, byte-identical
  semantics every time. The 5th run tests exactly what the 1st did.

The AI spend that *does* make sense — figuring out the flow in the first place —
is paid **once**, at authoring time, not on every verification. That's the core
economic argument: **Playwright MCP puts the LLM inside the loop; Verfix takes
it out of the loop and keeps it as a fallback** (assisted-mode healing when a
selector drifts).

---

## 4. The reliability argument: contracts beat narration

The failure mode Verfix exists for is subtle and common: an agent finishes a UI
change, drives the browser itself (via MCP or vision), looks at the result, and
declares success. Three problems:

1. **Grader bias.** The model evaluating "does this look right?" is the same
   model that wrote the code. It wants to succeed.
2. **Unstructured failure.** When something *is* wrong, the agent gets prose,
   not a machine-readable cause. "The button didn't seem to respond" could be a
   selector issue, a console error, a network failure, or a wrong URL — each
   with a completely different fix.
3. **Perverse incentives.** If a selector doesn't resolve, the cheapest path to
   "pass" is often to edit the *application source* (add a `data-testid`,
   change copy) rather than fix the actual problem. Nothing in an MCP loop
   detects this.

Verfix's answer to each, respectively:

1. Exact, typed assertions the model can't negotiate with.
2. A stable 8-type failure taxonomy plus a `fix_hint`, designed to be
   pattern-matched by agents — field names are a semver-guarded contract.
3. The **source guard**: every run reports which project files changed during
   the verify cycle as a typed `source_changes` signal, with a `block` policy
   for CI. To our knowledge no LLM-driven browser tool has an equivalent,
   because the problem only exists once you take the verify loop seriously.

---

## 5. Where Playwright MCP is genuinely better (be honest)

Marketing that pretends a Microsoft-backed standard has no advantages will get
laughed out of the room. Playwright MCP is the better tool when:

- **The flow is unknown.** Exploratory QA, bug reproduction from a vague report,
  "go find out why the dashboard looks broken" — an LLM improvising in a real
  browser is exactly right. Verfix has an `exploratory` mode, but it's the same
  technique and not a differentiator.
- **It's a one-off.** If you'll only ever check something once, writing a flow
  config is overhead. Deterministic replay pays off on the *second* run.
- **You're generating tests.** Playwright's planner/generator/healer test
  agents produce real `@playwright/test` suites. If your team already lives in
  Playwright Test, that's a strong gravity well.
- **You need the long tail of browser control.** 40+ tools, network mocking,
  multi-tab, arbitrary interaction — Verfix's step vocabulary is intentionally
  narrower.
- **Ecosystem and trust.** Microsoft maintains it, every MCP client supports
  it, and the community is enormous. Verfix is a young independent project —
  adopters are betting on a contract, not a giant.

The honest competitive threat to name internally: **Playwright itself is moving
up the stack.** ARIA snapshots give assertion-against-accessibility-tree,
codegen gives flow capture, and test agents give healing. What Playwright does
*not* have is the agent-native run contract — the JSON output, typed failure
taxonomy, fix hints, and source guard purpose-built for a coding agent's verify
loop. That contract, and the "zero-token verify" economics, are the moat. Keep
them sharp.

---

## 6. When Verfix is *not* worth adopting

Also be honest with prospects — a mismatched user churns and badmouths:

- You don't use AI coding agents. Verfix's contract is agent-facing; humans
  writing tests by hand are better served by `@playwright/test` directly.
- You already have a mature Playwright/Cypress E2E suite wired into CI. Verfix
  overlaps with it; the marginal value is the agent loop, not the coverage.
- Your app is one static page. Just assert with `curl` and grep.
- You need cross-browser matrix testing today (Verfix runs Chromium).

---

## 7. The actual positioning statement

> **Playwright MCP gives your agent hands. Verfix gives your agent a
> lie detector.**

Or, less punchy and more precise:

> Verfix is the deterministic verification step for AI coding loops. Agents
> explore and author flows once — with AI, even with Playwright MCP — then
> Verfix replays them for zero tokens, in seconds, with typed pass/fail
> results the agent can't argue with, a recorded trace a human can audit, and a
> guard that stops the agent from rewriting your source code to make its own
> test pass.

### Recommended usage pattern (this is the "better together" story)

1. **Explore** (once): agent uses Playwright MCP or `verfix` exploratory mode
   to understand the flow on a page it's never seen.
2. **Compile** (once): agent writes the flow into `verfix.config.json`, reusing
   selectors that already exist in the source (config-first, no `data-testid`
   spam).
3. **Verify** (forever): every subsequent edit → verify iteration, and every CI
   run, is a strict-mode Verfix run — deterministic, free, fast, audited.

The LLM is spent where it adds value (understanding), and removed where it adds
variance and cost (verification). That is the entire philosophy of the product:
**deterministic first, AI as a fallback — never the other way around.**

---

## Appendix: quick capability reference

| Verfix concept | Where it lives |
|---|---|
| Flow config contract | `verfix.config.json` — flows with `id`, `steps`, `assertions`, per-flow `mode` |
| Execution modes | `strict` (no AI, CI-safe) / `assisted` (AI heals drifted selectors) / `exploratory` (NL-driven) |
| JSON run contract | `passed`, `failures[]` (typed), `fix_hint`, `trace_path`, `show_command`, `source_changes` |
| Failure taxonomy | `selector_not_found`, `selector_not_visible`, `text_mismatch`, `url_mismatch`, `console_error`, `network_failure`, `timeout`, `assertion_failed` |
| Source guard | `sourceCodePolicy: warn \| block \| off`; typed `source_edit_warning` / `source_edit_blocked` |
| Observability | Playwright trace zip per run; `verfix show <id>`; last 20 runs kept in `.verfix/runs/` |
| Runtime | Local-first, in-process, no Docker/Redis/API; opt-in `--server` stack for the future hosted CI product |

*Sources on Playwright MCP capabilities:* [playwright.dev MCP docs](https://playwright.dev/mcp/introduction),
[microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp),
[Playwright test agents & MCP 2026 architecture](https://testquality.com/playwright-test-agents-mcp-architecture-2026/),
[Playwright AI ecosystem 2026](https://testdino.com/blog/playwright-ai-ecosystem).
