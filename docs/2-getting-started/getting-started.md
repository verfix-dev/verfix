# Getting Started

Verfix is a local-first AI verification runtime. This guide will walk you through setting up Verfix and running your first verification flow.

## 1. Installation

The easiest way to get started is using the Verfix CLI to initialize your project:

```bash
npx verfix init
```

This command will:
1. Create a `verify.config.json` file for your configuration.
2. Generate an `AGENTS.md` file as a single source of truth for humans and AI agents.

## 2. Starting the Runtime

Verfix runs entirely locally via Docker. Ensure Docker is running, then start the infrastructure:

```bash
docker run -d --name verfix -p 3001:3001 -p 3000:3000 -e AI_API_KEY=your_key -e AI_MODEL=gpt-4o-mini ghcr.io/verfix-dev/verfix-server:latest
```

This spins up the Go API, Next.js Dashboard, Redis, PostgreSQL, and Playwright Workers within a single orchestrated container.

## 3. Your First Verification

Open the `verify.config.json` file generated in step 1 and add a simple configuration:

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
npx verfix run -c verify.config.json
```

## 4. Access the Dashboard

Once the execution completes, open the Dashboard to view the Execution Intelligence Timeline:

```
http://localhost:3000
```
