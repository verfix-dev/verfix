# Security

Security is a core consideration for Verfix, as the runtime executes arbitrary browser flows that may interact with sensitive environments.

## Local-First Architecture
By design, Verfix executes entirely on your local machine or within your designated CI/CD environment via Docker. Execution telemetry, HAR files, and traces are never sent to external servers unless you explicitly configure an external database.

## Playwright Sandboxing
All browser executions run within isolated Playwright contexts. Local storage, cookies, and cache are strictly scoped to the individual execution and wiped upon completion.

## Reporting Vulnerabilities
If you discover a security vulnerability within Verfix, please refrain from opening a public issue. Instead, email `security@verfix.dev`. We aim to address all security concerns within 48 hours.
