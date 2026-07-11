# Benchmark methodology: loop-closure rate

Verfix's product metric is **loop-closure rate** — not selector accuracy,
not raw execution speed, not a healing percentage. Everything else is a
means to this end.

> Narrative walkthrough with a worked example — how a benchmark run unfolds,
> taking a release measurement, and reading results honestly:
> [the loop-closure benchmark guide](../4-guides/loop-closure-benchmark.md).

## What it measures

Take a coding agent, a tiny app with one deliberate defect, and Verfix's
JSON output as the *only* failure signal the agent gets — no human looking
at a browser, no extra hints. Does the agent reach the intended fix and does
Verfix's next run pass? That's one closed loop. Run this across a set of
cases and:

```
loop-closure rate = closed cases / total cases
```

This is the product metric because it's the thing Verfix actually sells:
a failure payload detailed and honest enough that an agent can act on it
without a human in the loop. Every change to `fix_hint` text, `findings[]`
detail, or the failure taxonomy is judged by whether it moves this number —
not by whether it looks more informative.

## Case format and anti-cheat invariants

See `benchmark/README.md` for the full case format (`app/server.js`,
`verfix.config.json`, `case.json`, `fixed/`) and the anti-cheat invariant
system that stops an agent from "passing" by deleting or weakening an
assertion, or by patching app source when the intended fix belongs in
config. That document is the source of truth for the harness mechanics;
this one stays about what the numbers mean.

## Null/oracle self-test

Two special `--agent` values validate the benchmark itself rather than a
real agent:

- `--agent null` does nothing to fix the defect. Expected closure rate: 0%
  (the floor). If any case closes under `null`, that case doesn't actually
  reproduce a failure and needs fixing.
- `--agent oracle` applies each case's own known-good fix (`fixed/`)
  verbatim. Expected closure rate: 100% (the ceiling). If a case doesn't
  close under `oracle`, the case's intended fix is broken, not the agent
  being measured.

CI runs both as a paired self-test on every push (see `.github/workflows/ci.yml`,
job "Benchmark self-test") — `run.js` exits nonzero if `null` closes anything
or if `oracle` fails to close everything. This keeps the 8 cases from
rotting silently as the engine changes underneath them.

## Taking a release measurement

```bash
node benchmark/run.js --agent '<your agent cmd>' --out benchmark/results/<date>-<label>.json
```

Commit the resulting file under `benchmark/results/` alongside the release
it measures (see `benchmark/results/README.md` for the naming convention).
To see the trend across every committed measurement:

```bash
node benchmark/run.js --report
```

This prints a markdown table — version, date, agent, closure rate, mean
iterations, per-case pass/fail — sorted oldest to newest. No browser runs;
it only reads `benchmark/results/*.json`.

## Honest caveats

- **8 cases is a small sample.** A single case flipping from closed to
  unclosed moves the aggregate rate by 12.5 points. Treat a 1-case move
  between releases as a hint worth investigating, not proof of a
  regression or improvement.
- **The cases are not exhaustive.** They cover the failure taxonomy's
  major categories (selector drift, occluding overlays, stale sessions,
  console-error cascades, route changes, slow endpoints, API regressions,
  copy changes) but new cases get added over time as real field reports
  surface failure modes the current set doesn't reproduce — see
  `benchmark/README.md`'s "Adding a case."
- **The number is about the fix loop, not the agent.** A low closure rate
  for a given agent command might mean the agent is weak, or it might mean
  Verfix's failure payload for that case genuinely lacks the detail needed
  to act — the harness can't tell those apart on its own. Read the failing
  case's `fix_hint`/`findings` output before concluding either way.
