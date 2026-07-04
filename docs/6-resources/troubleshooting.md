# Troubleshooting

## Local Mode (default)

### Start with `verfix doctor`
It checks everything the local runner needs: Node ≥20, a valid
`verfix.config.json`, `AGENTS.md`, Chromium, and whether your app's `baseUrl`
is reachable. Docker being absent is never a failure in local mode.

### Playwright "Executable doesn't exist" / Chromium download failed
`verfix run` downloads Chromium automatically on first use (~130MB, cached in
`~/.cache/ms-playwright`). If the download keeps failing (proxy/firewall), you
have two options:
- Reuse your installed Chrome: set `"browser": { "channel": "chrome" }` in `verfix.config.json`.
- Install manually: `npx playwright install chromium`.

### App not reachable
Local mode drives the browser on your machine, so `baseUrl` must be reachable
from your machine — start your dev server first. There is no Docker networking
to configure.

### Where did my run go?
Results and traces are plain files under `.verfix/runs/` (newest 20 kept).
`verfix list` shows recent runs; `verfix show <execution_id>` opens the
Playwright trace viewer.

## Server Mode (`--server`)

### Container Exits Immediately
Check the container logs to see if PostgreSQL or Redis failed to initialize.
```bash
docker logs -f verfix
```

### Dashboard Shows Blank / 500 Error
Verfix defaults to dashboard/API ports `3610/3611` and auto-falls back (`3612/3613`, etc.) when occupied.
Check the active values in `.verfix/runtime.json`, then verify those ports are reachable.

### Playwright "Executable doesn't exist" (in the container)
This means the runtime image was built without properly downloading the Chromium binaries. If you are modifying the Dockerfile locally, ensure `npx playwright install chromium` runs successfully.

### Images Not Showing in Replay Tab
By design, Verfix only captures individual event screenshots upon failure or retry. If a test passes seamlessly, the Replay tab will fallback to the final execution snapshot.
