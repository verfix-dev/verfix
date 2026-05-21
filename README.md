# Verfix

[![npm version](https://img.shields.io/npm/v/verfix.svg)](https://www.npmjs.com/package/verfix)
[![Docker Image Version (latest by date)](https://img.shields.io/ghcr/v/verfix-dev/verfix-server)](https://github.com/verfix-dev/verfix/packages)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

**Local-first AI verification runtime for AI-generated web applications.**

[Website](https://verfix.dev) • [Documentation](https://verfix.dev/docs) • [NPM Package](https://www.npmjs.com/package/verfix) • [Docker Image](https://github.com/verfix-dev/verfix/packages)

---

## The Problem

AI coding agents can generate entire application flows in seconds, but verifying that those flows actually work in a real browser remains a human bottleneck. 

Developers are still manually opening browsers, clicking through flows, inspecting UIs, and debugging regressions. While AI agents are excellent at writing code, they lack the deterministic infrastructure required to confidently verify browser behavior and catch regressions before they merge.

## The Solution

**Verfix** is a browser execution runtime designed specifically for coding agents. It provides a highly observable, local-first verification environment where agents can execute structured browser flows, assert behaviors deterministically, and consume structured execution timelines.

Verfix is **not** a generic AI agent or a chatbot wrapper. It is verification infrastructure. Our core philosophy is that **reliability emerges from structured contracts, not unconstrained intelligence.**

---

## Key Features

- **Strict Mode**: Deterministic browser verification using stable selectors and assertions. Perfect for CI/CD and regression testing.
- **Assisted Mode**: Deterministic execution enhanced with semantic healing. If a strict selector fails, the runtime uses AI to intelligently recover the flow.
- **Exploratory Mode**: Flexible browser exploration using natural language tasks and semantic reasoning.
- **Execution Timeline**: High-fidelity observability with event-driven timelines, capturing every action, navigation, console error, and network request.
- **Structured Outputs**: Agents consume strict JSON outputs and failure classifications, not messy HTML dumps.
- **Local-first Runtime**: Entirely orchestratable via Docker on your local machine.

---

## Architecture Overview

Verfix relies on a deterministic-first engine. The runtime is packaged as a single unified Docker container orchestrating the API, Queue, Playwright Workers, and Dashboard.

```text
+-------------------+       +-----------------------+
|   Coding Agent    | ----> |    Verfix Runtime     |
| (Cursor, Claude)  |       |   (Local / Docker)    |
+-------------------+       +-----------------------+
                                        |
                                        v
+-------------------+       +-----------------------+
|  Structured Data  | <---- |   Browser Execution   |
|  (JSON, Events)   |       | (Playwright + BullMQ) |
+-------------------+       +-----------------------+
```

## Quick Start

### 1. Initialize

Use the CLI to initialize a Verfix environment in your project:

```bash
npx verfix init
```

This will create a `.verfix` directory and a `.env` file for configuration.

### 2. Start the Runtime

```bash
npx verfix start
```

This spins up the local Docker runtime (API, Dashboard, Redis, PostgreSQL, Playwright Workers).

### 3. Run a Verification Flow

```bash
npx verfix run login-flow.json
```

Or via the SDK:

```typescript
import { VerfixClient } from 'verfix';

const verfix = new VerfixClient();

const result = await verfix.verify({
  url: 'http://localhost:3000',
  mode: 'assisted',
  task: 'Verify the login flow',
  assertions: [
    { type: 'element_visible', target: { testId: 'user-profile' } }
  ]
});

console.log(result.passed); // true
```

---

## Monorepo Structure

| Directory | Description |
|-----------|-------------|
| [`api/`](./api/README.md) | Go-based Fiber API handling execution ingestion and state. |
| [`workers/`](./workers/README.md) | Node.js Playwright workers orchestrated via BullMQ. |
| [`dashboard/`](./dashboard/README.md) | Next.js execution observability dashboard. |
| [`cli/`](./cli/README.md) | Command-line interface for local runtime lifecycle management. |
| [`sdk/`](./sdk/README.md) | TypeScript SDK for agent and script integrations. |
| [`docs/`](./docs/README.md) | Complete documentation. |

---

## Documentation

- [What is Verfix?](./docs/1-introduction/what-is-verfix.md)
- [Getting Started](./docs/2-getting-started/getting-started.md)
- [Execution Modes](./docs/3-core-concepts/execution-modes.md)
- [Observability Pipeline](./docs/1-introduction/observability-core.md)
- [Agent Integrations](./docs/4-guides/agent-integrations.md)

---

## Contributing

We welcome contributions. Please read our [Contributing Guide](./CONTRIBUTING.md) to learn about our development workflow, architecture philosophy, and coding standards.

## License

Apache 2.0 License. See [LICENSE](./LICENSE.md) for details.
