# Getting Started

Verfix is a local-first AI verification runtime. This guide will walk you through setting up Verfix and running your first verification flow.

## 1. Installation

The easiest way to get started is using the Verfix CLI to initialize your project:

```bash
npx verfix init
```

> **Tip:** For non-interactive environments, CI/CD pipelines, or AI coding agents, pass the `--yes` (or `-y`) flag: `npx verfix init --yes`. See the main README for all available configuration flags and environment variables.

This command will:
1. Create a `verfix.config.json` file for your configuration.
2. Generate an `AGENTS.md` file as a single source of truth for humans and AI agents.

## 2. Starting the Runtime

Verfix runs entirely locally via Docker. The easiest way to start it is with
the CLI — it automatically configures network settings for your platform:

```bash
npx verfix start
```

Or run the interactive setup wizard which pulls the image, starts the runtime,
and walks you through config (or bypass with `--yes`):

```bash
npx verfix init
```

This spins up the Go API, Next.js Dashboard, Redis, and the database (PostgreSQL or SQLite depending on mode). On macOS/Windows, Playwright workers run natively on your machine alongside your browser for direct localhost access.

> **Note:** The runtime needs to reach your app's dev server (e.g.
> `localhost:3002`). The CLI handles this automatically — you don't need to
> change how your app starts. See [Docker Networking](../4-guides/docker-networking.md)
> for the technical details.

## 3. Your First Verification

Open the `verfix.config.json` file generated in step 1 and add a simple configuration:

```json
{
  "baseUrl": "https://example.com",
  "mode": "strict",
  "task": "Verify the domain is example.com",
  "assertions": [
    { "type": "text_visible", "value": "Example Domain" }
  ]
}
```

Run it using the CLI:

```bash
npx verfix run
```

Alternatively, you can specify the config explicitly:
```bash
npx verfix run -c verfix.config.json
```

## 4. Access the Dashboard

Once the execution completes, open the Dashboard to view the Execution Intelligence Timeline:

```
http://localhost:3610
```
