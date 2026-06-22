#!/bin/sh
# verfix slim server startup script
# Runs inside the slim container: Redis → API → Workers → Dashboard
# No PostgreSQL — the API uses embedded SQLite (file at SQLITE_PATH).
# tini (PID 1) handles zombie reaping; we use wait-with-pid-tracking to die fast
# if any critical service exits unexpectedly.
set -e

# ── Inject host.docker.internal on Linux (bridge mode only) ──────────────────
# When VERFIX_HOST_NETWORK=1 the container uses --network=host.
# In that mode localhost IS the host — no injection needed.
# In bridge mode (Mac/Windows or manual docker run without --network=host):
#   Docker Desktop injects host.docker.internal automatically.
#   On plain Linux bridge we inject it ourselves from the routing table.
if [ "${VERFIX_HOST_NETWORK}" != "1" ]; then
  if ! grep -q "host.docker.internal" /etc/hosts 2>/dev/null; then
    # Primary: use the default route gateway (works for standard Docker bridge).
    HOST_GW=$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)
    # Fallback: on custom bridge networks, the default route gateway may not be
    # the host. Try the docker0 interface IP as a fallback.
    if [ -z "$HOST_GW" ]; then
      HOST_GW=$(ip -4 addr show docker0 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
    fi
    if [ -n "$HOST_GW" ]; then
      echo "${HOST_GW}  host.docker.internal" >> /etc/hosts
      echo "✅ host.docker.internal → ${HOST_GW} (injected into /etc/hosts)"
    else
      echo "⚠  Could not detect host gateway — host.docker.internal will not resolve" >&2
    fi
  else
    echo "✅ host.docker.internal already present in /etc/hosts"
  fi
else
  echo "✅ Network mode: host — localhost resolves directly to the host (IPv4 + IPv6)"
fi

# ── Env defaults (all overridable via docker run -e / docker-compose env) ─────
REDIS_PORT="${REDIS_PORT:-6379}"
API_PORT="${API_PORT:-3611}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3610}"

export REDIS_HOST="${REDIS_HOST:-localhost}"
export REDIS_PORT="${REDIS_PORT}"
export SQLITE_PATH="${SQLITE_PATH:-/app/data/verfix.db}"

# ── 1. Redis ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Redis..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# SQLite data dir must exist before the API starts (it opens the file directly).
mkdir -p "$(dirname "${SQLITE_PATH}")"

redis-server --daemonize yes --port "${REDIS_PORT}" \
  --save "" \
  --appendonly no \
  --loglevel notice \
  --logfile /var/log/redis.log

# Wait for Redis to accept connections
retries=15
while [ "$retries" -gt 0 ]; do
  if redis-cli -p "${REDIS_PORT}" ping 2>/dev/null | grep -q PONG; then
    echo "✅ Redis is ready"
    break
  fi
  retries=$((retries - 1))
  sleep 1
done

if [ "$retries" -eq 0 ]; then
  echo "❌ Redis failed to start" >&2
  exit 1
fi

# ── 2. Go API ─────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Verfix API (Go)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# The API serves artifacts from ../workers/artifacts relative to its working dir.
# We set the working dir to /app/api so the path resolves to /app/workers/artifacts.
cd /app/api
/app/api/verfix-api &
API_PID=$!

# Wait for API health endpoint
retries=20
while [ "$retries" -gt 0 ]; do
  if curl -sf "http://localhost:${API_PORT}/api/v1/health" >/dev/null 2>&1; then
    echo "✅ Go API is ready on :${API_PORT}"
    break
  fi
  retries=$((retries - 1))
  sleep 1
done

if [ "$retries" -eq 0 ]; then
  echo "❌ Go API failed to start" >&2
  exit 1
fi

# ── 3. Workers (TypeScript, compiled to JS) ───────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Workers (BullMQ)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "${SKIP_WORKERS}" = "1" ]; then
  echo "⏭  Workers: skipped (SKIP_WORKERS=1 — running on host)"
  WORKERS_PID=""
else
  # Workers use __dirname — working dir must be /app/workers so paths resolve.
  # dist/src/index.js is the compiled entry since rootDir='.', outDir='./dist'.
  cd /app/workers
  node dist/src/index.js &
  WORKERS_PID=$!
  echo "✅ Workers started (PID ${WORKERS_PID})"
fi

# ── 4. Dashboard (Next.js standalone) ────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Dashboard (Next.js)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Standalone mode: next.config.ts sets output:'standalone', so Next.js emits
# .next/standalone/server.js — no npm start needed, just node server.js.
PORT="${DASHBOARD_PORT}" HOSTNAME="0.0.0.0" node /app/dashboard/server.js &
DASHBOARD_PID=$!

retries=20
while [ "$retries" -gt 0 ]; do
  if curl -sf "http://localhost:${DASHBOARD_PORT}" >/dev/null 2>&1; then
    echo "✅ Dashboard is ready on :${DASHBOARD_PORT}"
    break
  fi
  retries=$((retries - 1))
  sleep 1
done

# ── All services started ──────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🚀 Verfix Slim Server is running!"
echo ""
echo "    API:        http://localhost:${API_PORT}/api/v1"
echo "    Dashboard:  http://localhost:${DASHBOARD_PORT}"
echo "    Health:     http://localhost:${API_PORT}/api/v1/health"
echo "    Database:   SQLite (${SQLITE_PATH})"
if [ "${SKIP_WORKERS}" = "1" ]; then
  echo "    Workers:    running on host (hybrid mode)"
fi
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Monitor: exit container if any critical process dies ──────────────────────
# We track the two user-space processes (API + workers). Dashboard is less
# critical — Next.js will restart on its own port conflicts.
while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    echo "❌ Go API process died — shutting down container" >&2
    exit 1
  fi
  if [ -n "$WORKERS_PID" ] && ! kill -0 "$WORKERS_PID" 2>/dev/null; then
    echo "❌ Workers process died — shutting down container" >&2
    exit 1
  fi
  sleep 5
done
