# Installation

Verfix is designed to be installed globally or per-project via npm, relying on Docker to run the actual infrastructure.

## Requirements
- **Node.js**: v18 or newer
- **Docker**: Docker Desktop or Docker Engine installed and running

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

This creates the necessary `.verfix/` local configuration directory and prepares your `.env` file.
