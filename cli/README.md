# Verfix CLI

The command-line interface for managing the local Verfix Docker runtime.

## Installation
```bash
npm install -g verfix
```

## Commands

- `verfix init`: Creates `.verfix/` configuration directory.
- `verfix start`: Orchestrates the `ghcr.io/verfix-dev/verfix-server:latest` Docker container.
- `verfix stop`: Halts the runtime.
- `verfix run <file>`: Submits a verification payload to the API.
- `verfix logs`: Tails the Docker container logs.
