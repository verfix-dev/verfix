# CI/CD Integration

Verfix is designed to run in continuous integration pipelines to verify AI-generated PRs or standard regressions. Local mode makes this trivial: the runner needs only Node 20+ — no Docker services, no waiting for containers.

## GitHub Actions Example

```yaml
name: Verification
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      # Cache the one-time Chromium download between runs
      - uses: actions/cache@v4
        with:
          path: ~/.cache/ms-playwright
          key: playwright-chromium-${{ runner.os }}

      - name: Start your app
        run: npm ci && npm run start &   # whatever starts your dev server

      - name: Run verification
        run: npx verfix run --output json
        # strict mode is fully deterministic — no AI key needed
```

`verfix run` exits `0` on pass, `1` on verification failure, `2` on setup
errors — so the job fails naturally. On failure, upload the recorded traces as
an artifact for debugging:

```yaml
      - name: Upload traces on failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: verfix-traces
          path: .verfix/runs/
```

Download the artifact locally and open a trace with
`npx playwright show-trace <trace.zip>` (or `verfix show` inside the project).

## Server runtime in CI (optional)

If you specifically need the Docker server runtime (e.g. testing the hosted
stack itself), start it explicitly and pass `--server`:

```yaml
      - name: Start Verfix server runtime
        run: |
          docker run -d --network=host -e VERFIX_HOST_NETWORK=1 ghcr.io/verfix-dev/verfix-server:latest
          sleep 15 # Wait for services

      - name: Run Tests
        run: npx verfix run --server --output json
```
