# Installation

Verfix runs entirely on your machine with Node.js — no Docker, no services to
manage. The first run downloads a Chromium browser (~130MB, one-time, cached in
`~/.cache/ms-playwright`).

## Requirements
- **Node.js**: v20 or newer

That's the whole list. (Docker is only needed for the opt-in `--server` runtime
used by the future hosted product.)

## Global Installation (CLI)

```bash
npm install -g verfix
```

## Project Installation (SDK)

If you are integrating Verfix into your AI agent or CI pipeline, install the SDK as a dependency:

```bash
npm install verfix
```

## Initializing the Environment

Whether installed globally or locally, you must initialize Verfix in your project root:

```bash
npx verfix init
```

This detects your app's URL, scaffolds `verfix.config.json`, writes agent
instructions (`AGENTS.md` + `.verfix/INSTRUCTIONS.md`), and makes sure a
browser is available. The default `strict` mode needs no AI key.
