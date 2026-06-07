# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.5] - 2026-06-07

### Added
- Programmatic SDK for integration scenarios with class-based API.
- Platform-specific agent rules configuration support.
- Flow composability features for building complex verification workflows.
- Clean JSON output mode for CLI enabling machine-readable output.
- Exit code contracts for CLI commands providing predictable return values.
- Agent platform integration support for expanded extensibility.

### Changed
- SDK upgraded to class-based API for improved ergonomics and type safety.

### Fixed
- Improved image capturing system to save disk space in execution artifacts.

## [0.1.4] - 2026-05-25

### Added
- Introduced runtime port management with new defaults: Dashboard `3610`, API `3611`.
- Added automatic port-pair fallback when defaults are occupied (`3612/3613`, `3614/3615`, ...).
- Added runtime port persistence in `.verfix/runtime.json`.
- Added container-to-CLI runtime port sync so CLI reflects actual running container ports.

### Changed
- Updated CLI commands (`start`, `status`, `run`, `list`, `doctor`, `init`) to use shared runtime-resolved ports.
- Updated dashboard API endpoint resolution to derive API base dynamically from dashboard origin.
- Updated runtime defaults and documentation references from `3000/3001` to `3610/3611`.

### Fixed
- Fixed `verfix init` app-port auto-detection incorrectly selecting runtime/API ports as the user's app port.
- Fixed repeated `init`/`start` workflows to behave idempotently without stale port output.
- Fixed stale API port behavior by adding API health-based fallback discovery (including legacy `3001`) and self-healing runtime port persistence.

## [0.1.3] - 2026-05-23

### Fixed
- Resolved an issue where the CLI version was hardcoded to `0.1.0` inside the Commander configuration. The CLI now dynamically loads its version from `package.json` at runtime.

## [0.1.2] - 2026-05-23

### Fixed
- Fixed Docker container networking issues to reliably access services running on the host machine (e.g., local dev servers).
  - Implemented platform-specific networking: host networking (`--network=host`) on Linux to share the host network stack (allowing native `localhost` and IPv6 access).
  - Maintained bridge mode with `host.docker.internal` DNS resolution on macOS and Windows.

## [0.1.1] - 2026-05-22

### Added
- Implemented the interactive setup wizard via `verfix init` command to configure runtime environments, generate default verification flows, and scaffold `AGENTS.md` guides.
- Improved CLI stability and environment variable persistence into container runtimes.

## [0.1.0] - 2026-05-21

### Added
- Initial release of the Verfix local-first verification runtime.
  - Local Docker-powered execution environment for reliable browser verification.
  - Real-time API service and Execution Replay Dashboard for timeline observability.
  - Built-in assertion engine with automated troubleshooting and fix suggestions.
  - Verification diagnostic CLI utility (`verfix doctor`).
