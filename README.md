# soma-ehr

pnpm monorepo for the Soma EHR project.

## Layout

| Path | Package | Role |
|------|---------|------|
| `apps/api` | `@soma-ehr/api` | HTTP API (Express, TypeScript) |
| `packages/database` | `@soma-ehr/database` | Postgres client, SQL migrations |
| `packages/shared` | `@soma-ehr/shared` | Shared types and utilities |

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/installation) 9+
- [PostgreSQL](https://www.postgresql.org/) (for database workflows)

## Setup

```bash
pnpm install
```

TypeScript packages extend [`tsconfig.base.json`](tsconfig.base.json) at the repo root. The API package overrides module settings for `ts-node-dev` compatibility; the database package uses native ES modules (`"type": "module"`).

## Environment variables

Create a `.env` at the **repository root** (or under `packages/database/` for package-only overrides). Git ignores `.env` files—see [`.gitignore`](.gitignore).

| Variable | Used by | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `@soma-ehr/database`, `@soma-ehr/api` | Postgres connection string (API uses its own pool for transactional routes) |
| `PORT` | `@soma-ehr/api` | HTTP port (default `3000`) |
| `CLERK_PUBLISHABLE_KEY` | `@soma-ehr/api` | Clerk publishable key (JWT verification / middleware; see [Clerk Dashboard](https://dashboard.clerk.com/)) |
| `CLERK_SECRET_KEY` | `@soma-ehr/api` | Clerk secret key (backend; keep server-side only) |

The database package loads root `.env` first, then `packages/database/.env`, so local DB settings can override when needed.

## API

```bash
# from repo root
pnpm --filter @soma-ehr/api dev

# or from apps/api
pnpm dev
```

- Health check: `GET http://localhost:3000/health` → `{ "status": "ok" }` (public; no auth)

Protected routes should use `clerkMiddleware()` (already applied in `createApp`) plus `requireAuthContext` from `src/middleware/auth.ts`, which validates the Clerk session JWT (including `Authorization: Bearer <token>`) and sets `req.authContext.userId`.

Organization-scoped JSON APIs also require header **`X-Organization-Id`** (UUID), validated in `src/middleware/organizationContext.ts`.

- **Medications:** `PUT /api/medications/:id` — authenticated, tenant-scoped update. Runs in a single DB transaction: locks row, writes prior state to `medication_history`, updates `medications`, inserts `audit_log`, returns the updated row. Requires `DATABASE_URL` and migration **`005_audit_log_actor_text`** applied (Clerk subject ids are stored as text on `audit_log.actor_user_id`).
- **Smoke test:** create (SQL) → update (curl) → verify — see [docs/medication-smoke-test.md](docs/medication-smoke-test.md) and `scripts/medication-smoke-test.sh`.

## Database

SQL migrations live in `packages/database/migrations/` (numbered `*.sql` files). Applied migrations are recorded in the `schema_migrations` table.

```bash
# verify Postgres connectivity
pnpm --filter @soma-ehr/database db:test

# apply pending migrations
pnpm --filter @soma-ehr/database migrate
```

Migrations run in order (sorted by filename) inside a transaction per file. Add new files such as `002_description.sql`.

## Workspace commands

Use `pnpm --filter <package-name> <script>` from the repo root, or `cd` into a package and run `pnpm <script>` there.
