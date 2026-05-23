# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
