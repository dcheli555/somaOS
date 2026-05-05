#!/usr/bin/env bash
# Start local dev stack: Postgres (Docker Compose) → db check → migrations → apps.
#
# From repo root:
#   bash scripts/start-dev.sh
# or:
#   pnpm dev:stack
#
# Environment (optional):
#   SKIP_DOCKER=1          Skip Postgres / Docker (uses native/other Postgres; optional nc wait below).
#   SKIP_PG_WAIT=1         With SKIP_DOCKER=1: do not nc-wait on PG_WAIT_*.
#   SKIP_MIGRATE=1        Skip migrations (still runs db:test if not skipped).
#   SKIP_DB_CHECK=1       Skip db:test and migrate.
#   START_CLERK_DEV=1     Also run @soma-ehr/clerk-dev on :5173 (stops when you Ctrl+C API).
#   PG_WAIT_HOST=127.0.0.1  PG_WAIT_PORT=5432  (used when SKIP_DOCKER=1 and nc is available)
#   POSTGRES_*            Passed through to Compose (see compose.yml).
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SKIP_DOCKER="${SKIP_DOCKER:-0}"
SKIP_MIGRATE="${SKIP_MIGRATE:-0}"
SKIP_DB_CHECK="${SKIP_DB_CHECK:-0}"
START_CLERK_DEV="${START_CLERK_DEV:-0}"

PG_WAIT_HOST="${PG_WAIT_HOST:-127.0.0.1}"
PG_WAIT_PORT="${PG_WAIT_PORT:-5432}"
PG_WAIT_SECONDS="${PG_WAIT_SECONDS:-45}"

needs_cmd() {
  command -v "$1" >/dev/null 2>&1
}

wait_for_tcp_nc() {
  local host="$1" port="$2" max="$3" i
  echo "Waiting for Postgres at ${host}:${port} (up to ${max}s, nc)…"
  for ((i = 0; i < max; i++)); do
    if nc -z "${host}" "${port}" >/dev/null 2>&1; then
      echo "Port open."
      return 0
    fi
    sleep 1
  done
  echo "Timed out waiting for ${host}:${port}" >&2
  return 1
}

wait_postgres_compose() {
  local max="${PG_WAIT_SECONDS}" i
  echo "Waiting for Postgres (container pg_isready, up to ${max}s)…"
  for ((i = 0; i < max; i++)); do
    if docker compose -f "$ROOT/compose.yml" exec -T postgres pg_isready -U postgres >/dev/null 2>&1; then
      echo "Postgres ready."
      return 0
    fi
    sleep 1
  done
  echo "Postgres did not become ready." >&2
  return 1
}

compose_up_postgres() {
  if [[ ! -f "$ROOT/compose.yml" ]]; then
    echo "Missing compose.yml — cannot start Postgres automatically." >&2
    exit 1
  fi
  docker compose -f "$ROOT/compose.yml" up -d postgres
}

maybe_start_postgres() {
  if [[ "$SKIP_DOCKER" == "1" ]]; then
    echo "SKIP_DOCKER=1 — skipping Docker Postgres."
    if [[ "${SKIP_PG_WAIT:-0}" != "1" ]] && needs_cmd nc; then
      wait_for_tcp_nc "$PG_WAIT_HOST" "$PG_WAIT_PORT" "$PG_WAIT_SECONDS" || true
    fi
    return 0
  fi
  if ! needs_cmd docker; then
    echo "'docker' not found — start Postgres yourself or set SKIP_DOCKER=1." >&2
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "Docker daemon unreachable — open OrbStack/Docker Desktop or set SKIP_DOCKER=1." >&2
    exit 1
  fi
  compose_up_postgres
  wait_postgres_compose || exit 1
}

db_steps() {
  if [[ "$SKIP_DB_CHECK" == "1" ]]; then
    echo "SKIP_DB_CHECK=1 — skipping db:test / migrate."
    return 0
  fi
  pnpm --filter @soma-ehr/database db:test
  if [[ "$SKIP_MIGRATE" == "1" ]]; then
    echo "SKIP_MIGRATE=1 — skipping migrate."
  else
    pnpm --filter @soma-ehr/database migrate
  fi
}

clerk_pid=""
cleanup_clerk() {
  if [[ -n "${clerk_pid}" ]] && kill -0 "${clerk_pid}" 2>/dev/null; then
    kill "${clerk_pid}" 2>/dev/null || true
    wait "${clerk_pid}" 2>/dev/null || true
  fi
}

main() {
  echo "Starting soma-ehr dev stack from ${ROOT}"

  maybe_start_postgres

  if ! needs_cmd pnpm; then
    echo "'pnpm' not found — install pnpm (Corepack)." >&2
    exit 1
  fi

  db_steps

  trap cleanup_clerk EXIT INT TERM

  if [[ "$START_CLERK_DEV" == "1" ]]; then
    echo "Starting @soma-ehr/clerk-dev → http://localhost:5173 (background)"
    pnpm --filter @soma-ehr/clerk-dev dev &
    clerk_pid=$!
  fi

  echo "Starting @soma-ehr/api → http://localhost:${PORT:-3000}"
  pnpm --filter @soma-ehr/api dev
}

main "$@"
