# Contributing to Verfix

We appreciate your interest in contributing to Verfix. As an execution infrastructure project, we prioritize reliability, clean architecture, and rigorous code review.

## Architecture Philosophy

1. **Deterministic-First**: Never use an LLM for something that can be solved deterministically. AI is a fallback for resilience, not a replacement for good engineering.
2. **Local-First**: The runtime must always be fully orchestratable locally without requiring cloud dependencies.
3. **Observability is a Feature**: If a system fails, it must emit exactly why it failed. Silent failures or generic timeout errors are treated as critical bugs.

## Local Setup

### Prerequisites
- Docker & Docker Compose
- Node.js 20+
- Go 1.22+

### Development Environment

Clone the repository and install dependencies across the monorepo:

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix
npm ci --prefix api
npm ci --prefix workers
npm ci --prefix dashboard
npm ci --prefix cli
npm ci --prefix sdk
```

Start the local development stack:

```bash
# 1. Start Postgres & Redis
make up

# 2. In separate terminals, start the services:
make api
make worker
make ui
make cli
```

This will spin up:
- Go API on `:3001`
- Next.js Dashboard on `:3000`
- Redis & Postgres via Docker
- Playwright workers in watch mode

## Coding Standards

- **TypeScript**: Strict mode enabled. No `any` types unless absolutely interfacing with an untyped external boundary. Use standard `eslint` and `prettier`.
- **Go**: Follow standard Go formatting (`gofmt`). Ensure all errors are wrapped and logged with context.
- **Commit Conventions**: We follow Conventional Commits (e.g., `feat:`, `fix:`, `chore:`, `docs:`).

## PR Workflow

1. Fork the repository and create a branch (`feat/your-feature` or `fix/issue-description`).
2. Write tests for your changes.
3. Ensure all CI checks pass locally (if applicable).
4. Submit a Pull Request with a clear description of the problem solved and the architectural approach.
5. Require at least one approving review from a core maintainer before merging.

## Issue Labels

- `bug`: Something isn't working as expected.
- `enhancement`: New feature or request.
- `reliability`: Improvements to the deterministic execution engine or DOM stabilization.
- `ai-healing`: Improvements specifically targeting the Assisted/Exploratory semantic reasoning.
