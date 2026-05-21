# Local Development

If you are contributing to Verfix or modifying the runtime, follow this guide.

## Monorepo Setup

```bash
git clone https://github.com/verfix-dev/verfix.git
cd verfix
make install
```

## Running the Dev Stack

```bash
make dev
```
This spins up local infrastructure using Docker Compose while running the Go API and Next.js frontend on your host machine for fast iteration.

## Architecture Guidelines
- Do not add dependencies that break the single-container deployment model.
- Playwright workers must be compiled via `tsc` before packaging into the Docker image; `ts-node` is not used in production.
