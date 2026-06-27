# Hybrid Mode Architecture & Troubleshooting Guide

This guide details the design, technical architecture, and troubleshooting history of **Hybrid Mode** in Verfix. 

---

## 1. Overview & Architecture

### Why Hybrid Mode?
In containerized verification runtime environments, running Playwright browsers inside standard Docker containers on **macOS** and **Windows** presents networking challenges:
* Docker Desktop on Mac and Windows runs inside a virtual machine (WSL2, Hyper-V, or Virtualization Framework).
* Host networking (`--network=host`) is not natively supported by Docker Desktop on Mac/Windows.
* As a result, Playwright browsers inside a container cannot easily access web applications running on the user's host machine at `http://localhost:<port>`.

### How Hybrid Mode Works
To deliver seamless local-first verification across all operating systems, Verfix implements a **Hybrid Architecture**:

```
 ┌───────────────────────────────────────────────────────────┐
 │                       HOST MACHINE                        │
 │                                                           │
 │  ┌──────────────────────┐      ┌───────────────────────┐  │
 │  │   AI Agent / User    │      │    Playwright Worker  │  │
 │  │      CLI Run         │      │  (Node.js + Chromium) │  │
 │  └──────────┬───────────┘      └───────────▲───────────┘  │
 │             │                              │              │
 │             │ HTTP POST                    │ Redis BLPOP  │
 │             ▼                              │ (127.0.0.1)  │
 ├─────────────┼──────────────────────────────┼──────────────┤
 │             │      DOCKER CONTAINER        │              │
 │  ┌──────────▼───────────┐      ┌───────────┴───────────┐  │
 │  │      Go API          │─────►│        Redis          │  │
 │  │   (Port 3611)        │      │     (Port 6379)       │  │
 │  └──────────────────────┘      └───────────────────────┘  │
 └───────────────────────────────────────────────────────────┘
```

1. **Slim Container (`verfix-server-slim`)**: Hosts the Go API server, SQLite database, Dashboard UI, and Redis instance inside Docker.
2. **Host Worker (`~/.verfix/worker/`)**: Extracts compiled worker logic to the user's home directory and executes Playwright directly on the host OS.
3. **Queue Communication**: The Go API pushes verification jobs into a Redis queue (`verify_jobs`). The host worker connects via TCP to `127.0.0.1:6379` to pop and execute jobs using native host browsers.

---

## 2. Technical Issues & Solutions

During the implementation of Hybrid Mode on Windows, three distinct issues were encountered and resolved.

### Issue 1: Windows Symlink Privilege during Worker Extraction

#### Problem
When starting the runtime, `worker-runner.ts` extracts compiled worker code from the Docker container to `~/.verfix/worker/`. Originally, the CLI ran `docker cp` for `node_modules/`. 

Inside the Linux Docker image, `node_modules/.bin/` contained Linux symbolic links (e.g., `../msgpackr-extract/bin/download-prebuilds.js`). When `docker cp` attempted to recreate these on Windows, Windows raised a security error:
```text
symlink ..\msgpackr-extract\bin\download-prebuilds.js 
C:\Users\KIIT\.verfix\worker\node_modules\.bin\download-msgpackr-prebuilds: 
A required privilege is not held by the client.
```
On Windows, creating symbolic links requires either Administrator privileges or Windows Developer Mode enabled.

#### Solution
We revised the worker extraction strategy in `cli/src/worker-runner.ts`:
* Only plain compiled JavaScript (`dist/`) and manifests (`package.json`, `package-lock.json`) are copied from the container via `docker cp`.
* The CLI then runs `npm ci --omit=dev --ignore-scripts` natively on the host machine inside `~/.verfix/worker/`.
* Running `npm ci` on Windows natively creates standard `.cmd` executable shims in `.bin/` instead of Linux symlinks, resolving the privilege issue completely without requiring elevated rights.

---

### Issue 2: Redis Protected Mode Blocking Host Workers

#### Problem
Even after workers successfully started on the host, verification jobs submitted via `verfix run` remained stuck indefinitely in the `queued` or `running` state.

Inspection of raw TCP traffic between host Node.js and container Redis (`127.0.0.1:6379`) revealed:
```text
RESPONSE: -DENIED Redis is running in protected mode because protected mode is enabled and no password is set for the default user. In this mode connections are only accepted from the loopback interface.
```
Redis runs with `protected-mode yes` by default. When the host worker connected to container port 6379 via Docker's port mapping (`127.0.0.1:6379->6379`), Redis evaluated the request originating from the Docker network gateway interface rather than internal loopback, rejecting all command requests.

#### Solution
Explicitly disabled protected mode during Redis container startup.
* Modified `scripts/server-start-slim.sh` and `scripts/server-start.sh` to pass `--protected-mode no` when spawning `redis-server`.
* Executed runtime state update to ensure host processes can immediately query and pop jobs from `verify_jobs`.

---

### Issue 3: Redis Connection Retries (`maxRetriesPerRequest`) & IPv4 Resolution

#### Problem
In `~/.verfix/worker.log`, the worker continuously logged adapter exceptions:
```text
Adapter error: MaxRetriesPerRequestError: Reached the max retries per request limit (which is 20).
```
When Redis rejected requests during connection handshake or transient disconnects, `ioredis` attempted 20 retries before throwing an unhandled error. Once thrown, `ioredis` entered a stalled error state and stopped polling `blpop`. Furthermore, on Node.js 17+, resolving `localhost` prioritizes IPv6 (`::1`), whereas Docker container port bindings on Windows bind strictly to IPv4 (`127.0.0.1`).

#### Solution
* Set `maxRetriesPerRequest: null` on the adapter Redis client connection in `workers/src/index.ts`. Long-polling connections (`blpop`) in BullMQ and ioredis require `maxRetriesPerRequest: null` to allow infinite reconnect attempts without throwing exceptions.
* Standardized `REDIS_HOST` to explicit IPv4 (`127.0.0.1`) across `cli/src/worker-runner.ts` and `workers/src/index.ts`.

---

## 3. Code Modification Reference

### `cli/src/worker-runner.ts`
* Updated `extractWorkerFiles()` to copy only `dist/` and manifests, executing `npm ci` natively.
* Set `REDIS_HOST: '127.0.0.1'` in worker environment spawn parameters.

### `workers/src/index.ts`
* Configured `adapterConnection` with `maxRetriesPerRequest: null`.
* Updated default fallback host from `localhost` to `127.0.0.1`.

### `scripts/server-start-slim.sh` & `scripts/server-start.sh`
* Appended `--protected-mode no` to the `redis-server` invocation.

---

## 4. Verification & Health Check Commands

To verify that Hybrid Mode is operating correctly on host machines:

1. **Check Runtime Status**:
   ```bash
   verfix status
   ```
   *Expected Output:* Runtime running, API healthy, Dashboard healthy, Worker running on host.

2. **Run Verification Test (Headful Browser)**:
   ```bash
   verfix run --url https://example.com --show-browser
   ```
   *Expected Output:* Browser window opens, job completes in under 2 seconds, and structured JSON/pretty report is output with generated artifacts (`.png`, `.har`, `.json`, `.html`).
