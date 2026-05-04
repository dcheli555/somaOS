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
- [PostgreSQL](https://www.postgresql.org/) — local install **or** a container (see [Local development with Docker](#local-development-with-docker))

## Local development with Docker

macOS cannot run Linux containers natively; you need a **container engine** plus the **`docker` CLI**. Pick one:

| Option | Install (Homebrew) | Notes |
|--------|-------------------|--------|
| [OrbStack](https://orbstack.dev/) | `brew install --cask orbstack` | Lightweight; Docker-compatible. Open **OrbStack** from Applications and finish first-run setup so the engine runs and CLI tools are installed (often under `~/.orbstack/bin`). |
| [Docker Desktop](https://docs.docker.com/desktop/install/mac-install/) | `brew install --cask docker` | Official stack. Open **Docker** from Applications so the daemon starts. |
| Colima + CLI only | `brew install docker docker-compose colima` then `colima start` | No Docker Desktop app; Colima provides the VM and daemon. |

Confirm the CLI talks to the engine:

```bash
docker version
```

You should see both **Client** and **Server** sections. If the client is missing entirely (`docker: command not found`), OrbStack usually places `docker` in **`~/.orbstack/bin`** after the app has launched at least once. Add it to your shell `PATH`:

- **zsh** (default Terminal / Cursor): append to `~/.zshrc`  
  `export PATH="$HOME/.orbstack/bin:$PATH"`
- **bash**: append to `~/.bash_profile` (or `~/.bashrc` if that is what you source) — same line as above  

Then run `source ~/.zshrc` or `source ~/.bash_profile` and try `docker version` again.

**Fallback:** install only the CLI with Homebrew — `brew install docker` — while OrbStack supplies the daemon. See [OrbStack Docker docs](https://docs.orbstack.dev/docker/) if paths still do not resolve.

**OrbStack + Homebrew `docker` (wrong socket):** if you see an error mentioning **`unix://.../.docker/run/docker.sock`** and **`no such file or directory`**, the CLI expects **Docker Desktop’s** socket, while OrbStack uses **`~/.orbstack/run/docker.sock`**. Ensure **OrbStack is running**, then **`docker context use orbstack`** (check contexts with **`docker context ls`**). If you exported **`DOCKER_HOST`** in **`~/.zshrc`** or **`~/.bash_profile`** to Docker Desktop’s path, **`unset DOCKER_HOST`** or remove it— it overrides contexts.

### Postgres in Docker

Run Postgres on port `5432` with a named volume so data survives container restarts:

```bash
docker run --name soma-postgres \
  -e POSTGRES_PASSWORD=localdev \
  -e POSTGRES_DB=soma_ehr \
  -p 5432:5432 \
  -v soma_pgdata:/var/lib/postgresql/data \
  -d postgres:16
```

Set `DATABASE_URL` in the repo root `.env` (adjust user/password if you change them):

```text
postgresql://postgres:localdev@localhost:5432/soma_ehr
```

Then run [database migrations](#database) (`pnpm --filter @soma-ehr/database migrate`). Stop/remove the container when done: `docker stop soma-postgres` (remove with `docker rm soma-postgres` after stop).

## Setup

```bash
pnpm install
```

If Corepack errors with **`EACCES`** when creating **`~/.cache/node/corepack`**, your `~/.cache` directory may be owned by **`root`** (often from a past `sudo` install). Repair ownership with **`sudo chown -R "$(whoami)" ~/.cache`**, or set **`COREPACK_HOME`** to a directory under your home (for example **`$HOME/.local/share/corepack`**) and ensure it exists before running `pnpm` again.

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
