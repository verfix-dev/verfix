#!/bin/sh
# verfix server startup script
# Runs inside the single-image container: PostgreSQL → Redis → API → Workers → Dashboard
# tini (PID 1) handles zombie reaping; we use wait-with-pid-tracking to die fast
# if any critical service exits unexpectedly.
set -e

PG_DATA=/var/lib/postgresql/15/main
PG_CTL=/usr/lib/postgresql/15/bin/pg_ctl
PG_LOG=/tmp/pg.log        # /var/log is root-only; postgres user can write /tmp

# ── Inject host.docker.internal on Linux (bridge mode only) ──────────────────
# When VERFIX_HOST_NETWORK=1 the container uses --network=host.
# In that mode localhost IS the host — no injection needed.
# In bridge mode (Mac/Windows or manual docker run without --network=host):
#   Docker Desktop injects host.docker.internal automatically.
#   On plain Linux bridge we inject it ourselves from the routing table.
if [ "${VERFIX_HOST_NETWORK}" != "1" ]; then
  if ! grep -q "host.docker.internal" /etc/hosts 2>/dev/null; then
    HOST_GW=$(ip route show default 2>/dev/null | awk '{print $3}' | head -1)
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
POSTGRES_USER="${POSTGRES_USER:-verfix}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-verfix}"
POSTGRES_DB="${POSTGRES_DB:-verifydb}"
REDIS_PORT="${REDIS_PORT:-6379}"
API_PORT="${API_PORT:-3001}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3000}"

export DATABASE_URL="${DATABASE_URL:-postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}?sslmode=disable}"
export REDIS_HOST="${REDIS_HOST:-localhost}"
export REDIS_PORT="${REDIS_PORT}"

# ── Helper: wait for a TCP port to be accepting connections ───────────────────
wait_for_port() {
  local name="$1"
  local port="$2"
  local retries=30
  echo "⏳ Waiting for ${name} on port ${port}..."
  while [ "$retries" -gt 0 ]; do
    if curl -sf "http://localhost:${port}" >/dev/null 2>&1; then
      echo "✅ ${name} is ready"
      return 0
    fi
    retries=$((retries - 1))
    sleep 1
  done
  echo "❌ ${name} failed to start on port ${port}" >&2
  exit 1
}

# ── 1. PostgreSQL ─────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting PostgreSQL 15..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# If the data dir was wiped (fresh volume), re-initialise
if [ ! -f "${PG_DATA}/PG_VERSION" ]; then
  echo "⚙  Re-initialising Postgres data directory..."
  su -s /bin/sh postgres -c "/usr/lib/postgresql/15/bin/initdb -D ${PG_DATA}"
  su -s /bin/sh postgres -c "
    ${PG_CTL} -D ${PG_DATA} -l ${PG_LOG} start
    psql -c \"CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}' CREATEDB;\"
    psql -c \"CREATE DATABASE ${POSTGRES_DB} OWNER ${POSTGRES_USER};\"
  "
else
  su -s /bin/sh postgres -c "${PG_CTL} -D ${PG_DATA} -l ${PG_LOG} start"
fi

# Wait for Postgres to be ready
retries=20
while [ "$retries" -gt 0 ]; do
  if su -s /bin/sh postgres -c "psql -c '\q'" >/dev/null 2>&1; then
    echo "✅ PostgreSQL is ready"
    break
  fi
  retries=$((retries - 1))
  sleep 1
done

# ── 2. Redis ──────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Redis..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

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

# ── 3. Go API ─────────────────────────────────────────────────────────────────
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

# ── 4. Workers (TypeScript, compiled to JS) ───────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Starting Workers (Playwright/BullMQ)..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Workers use __dirname — working dir must be /app/workers so paths resolve.
# dist/src/index.js is the compiled entry since rootDir='.', outDir='./dist'.
cd /app/workers
node dist/src/index.js &
WORKERS_PID=$!
echo "✅ Workers started (PID ${WORKERS_PID})"

# ── 5. Dashboard (Next.js standalone) ────────────────────────────────────────
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
echo "  🚀 Verfix Server is running!"
echo ""
echo "    API:        http://localhost:${API_PORT}/api/v1"
echo "    Dashboard:  http://localhost:${DASHBOARD_PORT}"
echo "    Health:     http://localhost:${API_PORT}/api/v1/health"
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
  if ! kill -0 "$WORKERS_PID" 2>/dev/null; then
    echo "❌ Workers process died — shutting down container" >&2
    exit 1
  fi
  sleep 5
done
