# The loop-closure benchmark — full guide

> TL;DR: `benchmark/` contains deliberately broken apps. A harness runs a
> coding agent against each one with **only Verfix's JSON output** as the
> failure signal and scores whether the agent fixes it without human help.
> That score — the **loop-closure rate** — is Verfix's product metric.
> Reference docs: [`benchmark/README.md`](../../benchmark/README.md) (case
> format, adapter contract),
> [`benchmarks-methodology.md`](../6-resources/benchmarks-methodology.md)
> (what the numbers mean). This guide is the narrative: why it exists, how a
> run actually unfolds, and how to use it day to day.

## Why this exists

Verfix's promise is that when a browser check fails, a coding agent can read
the JSON report and fix the problem on its own. Features like `fix_hint`,
`findings[]`, and `page_state` all exist to serve that promise — but without
a measurement, "our failure reports are helpful" is an opinion. The benchmark
turns it into a number that can go up or down:

- **A proposed change** (new analyzer, reworded hint, new fact) is judged by
  whether it moves the number — not by how clever it sounds. If it doesn't
  move the number, it's probably noise.
- **A release** that drops the number regressed something agents relied on.
- **The trend across releases** is the honest answer to "is Verfix getting
  better at its actual job?"

## What one benchmark run looks like

Take the `occluding-modal` case (the canonical field-review failure). Its app
serves a checkout page where a full-viewport "What's new" dialog covers the
button the flow wants to click. The intended fix is one flow step that
dismisses the dialog.

The harness does this:

1. **Isolate.** Copies the case's `app/` + `verfix.config.json` into a fresh
   temp workspace and starts the app on a free port. The `fixed/` overlay and
   `case.json` are withheld — the agent never sees the answer key.
2. **Fail.** Runs `verfix run --output json` in the workspace. The run fails;
   the JSON carries the failure type, a `blocking_overlay` finding naming the
   dialog, and `page_state` facts. On this first iteration the harness also
   records whether the failure type and finding match what `case.json`
   declared — so the benchmark doubles as a regression test on Verfix's own
   reporting.
3. **Hand off.** Pipes that JSON to the agent adapter — any shell command,
   run with the workspace as its working directory:

   ```
   an open dialog "What's new in 2.4" (covering 100% of the viewport) was
   present at failure time and may be blocking or covering the target element.
   ```

   A capable agent reads that, opens `verfix.config.json`, and adds a
   dismiss-click step before the blocked one.
4. **Re-verify.** Runs Verfix again. Pass → stop; fail → hand off again, up
   to `max_iterations` (default 5).
5. **Audit.** A passing run only counts as **closed** if the case's
   anti-cheat invariants hold: assertions weren't deleted or weakened, and a
   config-scope case wasn't "fixed" by editing app source (or vice versa).
   An agent that makes the red light turn green by unscrewing the bulb scores
   zero.

Multiply by 8 cases spanning the failure taxonomy (selector drift, occluding
modal, stale session, console-error cascade, changed route, slow endpoint,
broken API, changed copy) and you get:

```
closure_rate=62% mean_iterations=2.4
```

## The three adapters

```bash
node benchmark/run.js --agent null      # floor — must score 0%
node benchmark/run.js --agent oracle    # ceiling — must score 100%
node benchmark/run.js --agent '<cmd>'   # the real measurement
```

- **`null`** does nothing between iterations. If any case closes anyway, that
  case was never really broken — the harness exits nonzero. This is the
  benchmark checking itself.
- **`oracle`** applies each case's committed known-good fix (`fixed/`). If
  any case *doesn't* close, the case's own answer key is wrong — nonzero
  again. CI runs the null/oracle pair on every push (the "Benchmark
  self-test" job), so cases can't silently rot.
- **`<cmd>`** is any coding-agent invocation. It receives the failure JSON on
  stdin, runs inside the workspace, edits files, exits 0. That's the whole
  contract — the benchmark has no opinion about which agent or model you use,
  which is exactly what makes the number comparable over time.

Useful flags: `--case <id>` runs one case; `--keep` preserves a failed case's
temp workspace for inspection; `--out <file>` writes the JSON result.

## Taking a release measurement

Once per release (not per commit — real agent runs cost money):

```bash
node benchmark/run.js \
  --agent 'your-agent-cli --instructions "Read the Verfix failure JSON on stdin and fix the flow"' \
  --out benchmark/results/2026-07-11-your-agent.json
git add benchmark/results/ && git commit -m "chore(benchmark): 0.4.0 measurement"
```

Then view the trend at any time — no browser runs, it just reads
`benchmark/results/`:

```bash
node benchmark/run.js --report
```

| version | date | agent | closure rate | mean iters | per-case |
|---|---|---|---|---|---|
| 0.4.0 | 2026-07-11 | your-agent | 62% | 2.4 | ✅✅❌✅✅❌✅❌ |
| 0.5.0 | … | your-agent | 75% | 2.1 | ✅✅✅✅✅❌✅❌ |

Keep the agent command and model **fixed across releases** — the point is to
measure Verfix's reporting, and changing the agent mid-series changes the
ruler.

## Reading the results honestly

- **8 cases is a small sample.** A one-case move (62% → 75%) is a hint, not
  proof. Direction over multiple releases is the signal.
- **`first_failure_type_ok: false` is a Verfix bug**, not an agent problem —
  the engine classified the failure differently than the case expects. (This
  already happened once: building `occluding-modal` exposed that an occluded
  click misreports as `selector_not_found` — issue #88.)
- **`invariants_ok: false` on a "passing" run** means the agent cheated. If a
  *good* agent keeps tripping an invariant, the invariant may be too strict —
  inspect with `--keep` before blaming the agent.
- **Mean iterations matters too.** A closure rate that holds while iterations
  drop means the first failure report is getting more actionable — that's
  `findings`/`fix_hint` doing their job.

## Growing the benchmark

New cases should come from **real field reports**, not imagination — a case
earns its slot by representing a failure that actually cost someone
diagnostic cycles. The mechanical steps (case layout, `case.json` schema,
verifying with the oracle/null pair) are in
[`benchmark/README.md`](../../benchmark/README.md#adding-a-case). Two rules
of thumb:

- One case = one defect with one clear intended fix. If the story needs two
  fixes, it's two cases.
- Always give the case invariants that make its cheat path fail. Ask: "what's
  the laziest way to make this flow pass without fixing the defect?" — then
  write the invariant that catches it.
