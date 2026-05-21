# Getting Started

Verfix is a local-first AI verification runtime. This guide will walk you through setting up Verfix and running your first verification flow.

## 1. Installation

The easiest way to get started is using the Verfix CLI.

```bash
npx verfix init
```

This command will:
1. Create a `.verfix/` directory in your project.
2. Generate a `.env` file for your configuration.

## 2. Starting the Runtime

Verfix runs entirely locally via Docker. Ensure Docker is running, then start the infrastructure:

```bash
npx verfix start
```

This spins up the Go API, Next.js Dashboard, Redis, PostgreSQL, and Playwright Workers within a single orchestrated container.

## 3. Your First Verification

Create a simple verification JSON file (`verify-login.json`):

```json
{
  "url": "https://example.com",
  "task": "Check that the header contains example domain",
  "mode": "strict",
  "assertions": [
    { "type": "url_contains", "value": "example" }
  ]
}
```

Run it using the CLI:

```bash
npx verfix run verify-login.json
```

## 4. Access the Dashboard

Once the execution completes, open the Dashboard to view the Execution Intelligence Timeline:

```
http://localhost:3000
```
