# Repository Guidelines

## Project Structure & Module Organization

Verfix is a monorepo for a local-first browser verification runtime. The main workspace packages are `cli/` for the TypeScript CLI, `workers/` for the Playwright engine, and `sdk/` for the TypeScript SDK. The server-mode API is in `api/` and is written in Go. Documentation lives in `docs/`, benchmark cases and results in `benchmark/`, local fixtures in `testbed/`, and helpers in `scripts/`. Package tests are colocated under each package's `test/` directory.

## Build, Test, and Development Commands

- `npm install`: install root workspace dependencies and link workspace packages.
- `npm run bench`: run the benchmark harness in `benchmark/run.js`.
- `cd cli && npm run build`: type-check and compile the CLI to `dist/`.
- `cd cli && npm test`: run the CLI test suite.
- `cd workers && npm run build`: compile the verification engine.
- `cd workers && npm test`: run engine, browser-step, assertion, and adapter tests.
- `cd sdk && npm run build`: compile SDK types and JavaScript output.
- `make up` / `make down`: start or stop Docker Compose services for server-mode work.
- `make api`, `make worker`, `make cli`: run the Go API, worker process, or CLI dev entrypoint.

## Coding Style & Naming Conventions

TypeScript packages use CommonJS, `ts-node` for tests, and `tsc` for builds. Keep source in `src/`, compiled output in `dist/`, and tests under `test/` with descriptive names such as `timeline.test.ts`. Follow existing formatting: two-space JSON indentation, semicolon-terminated TypeScript, and small focused modules. Format Go files in `api/` with `gofmt`.

## Testing Guidelines

Run narrow package tests for the area you change before broader checks. CLI tests are command and behavior focused; worker tests cover flow execution, assertions, page state, and adapters. Add or update tests beside the relevant package code. For benchmark behavior, add cases under `benchmark/cases/<case-name>/` with `case.json`, app fixtures, and `verfix.config.json`.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit style, for example `feat(benchmark): ...`, `chore(release): ...`, and `chore: ...`. Keep commit subjects imperative and scoped when useful. Pull requests should include a concise description, linked issue when applicable, test commands run, and screenshots or timeline links for user-visible browser verification changes.

## Security & Configuration Tips

Do not commit API keys, local `.verfix` run state, or generated credentials. Prefer environment variables for provider keys and local URLs. Read `SECURITY.md` before changing authentication, telemetry, networking, or runtime configuration.
