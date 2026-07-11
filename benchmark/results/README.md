# Benchmark results

One committed file per release measurement, named:

```
<YYYY-MM-DD>-<agent-label>.json
```

Each file is the harness's `--out` JSON verbatim (`agent`, `cases[]`,
`closure_rate`, `mean_iterations`, `verfix_version`, `date`). `<agent-label>`
identifies the coding agent that was measured (e.g. `claude-sonnet`,
`gpt-5`) — not a person, not a vendor slogan.

## Taking a measurement

```bash
node benchmark/run.js --agent '<your agent cmd>' --out benchmark/results/<date>-<label>.json
```

Commit the resulting file alongside the release it measures.

## Viewing the trend

```bash
node benchmark/run.js --report
```

Prints a markdown table — version, date, agent, closure rate, mean
iterations, and per-case pass/fail glyphs — sorted oldest to newest. This is
the release-over-release view; see
`docs/6-resources/benchmarks-methodology.md` for what the numbers mean.

Do not commit `--agent null` or `--agent oracle` runs here — those are CI
self-tests (see `benchmark/README.md`), not release measurements.
