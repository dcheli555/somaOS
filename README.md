# somaOS

pnpm monorepo for Soma OS.

## Layout

| Path | Package | Role |
|------|---------|------|
| `apps/api` | `@soma-os/api` | HTTP API (Express, TypeScript); integration tests **`pnpm --filter @soma-os/api test`** (`DATABASE_URL` + migrated DB) |
| `apps/clerk-dev` | `@soma-os/clerk-dev` | Minimal Vite + Clerk UI for **JWT** and **`X-Organization-Id`** (Phase 3 / curl testing) |
| `packages/database` | `@soma-os/database` | Postgres client, SQL migrations |
| `packages/shared` | `@soma-os/shared` | Shared types and utilities |

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
  -e POSTGRES_DB=soma_os \
  -p 5432:5432 \
  -v soma_pgdata:/var/lib/postgresql/data \
  -d postgres:16
```

Set `DATABASE_URL` in the repo root `.env` (adjust user/password if you change them):

```text
postgresql://postgres:localdev@localhost:5432/soma_os
```

Then run [database migrations](#database) (`pnpm --filter @soma-os/database migrate`). Stop/remove the container when done: `docker stop soma-postgres` (remove with `docker rm soma-postgres` after stop).

### Docker Compose + dev stack (recommended)

Root [`compose.yml`](compose.yml) runs the same Postgres image with defaults **`POSTGRES_PASSWORD=localdev`**, **`POSTGRES_DB=soma_os`**, port **5432**. Point **`DATABASE_URL`** at that database (example in the previous block).

From the repo root:

```bash
pnpm dev:stack
```

This script ([`scripts/start-dev.sh`](scripts/start-dev.sh)): starts **`docker compose up -d postgres`**, waits until **`pg_isready`** succeeds, runs **`pnpm --filter @soma-os/database db:test`** and **`migrate`**, then starts **`@soma-os/api`**. Optional: **`START_CLERK_DEV=1 pnpm dev:stack`** also runs **`clerk-dev`** on port **5173** in the background until you stop the API (**Ctrl+C**).

**Env toggles** (see comments in the script): **`SKIP_DOCKER=1`**, **`SKIP_MIGRATE=1`**, **`SKIP_DB_CHECK=1`**, **`SKIP_PG_WAIT=1`** (with **`SKIP_DOCKER=1`**), **`POSTGRES_DB` / `POSTGRES_PASSWORD`** for Compose.

If you already created a container named **`soma-postgres`** manually, either remove it (`docker rm -f soma-postgres`) before first **`compose up`**, or align your existing container with the Compose settings so there is no port/name conflict.

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
| `DATABASE_URL` | `@soma-os/database`, `@soma-os/api` | Postgres connection string (API uses its own pool for transactional routes) |
| `PORT` | `@soma-os/api` | HTTP port (default `3000`) |
| `CLERK_PUBLISHABLE_KEY` | `@soma-os/api` | Clerk publishable key (JWT verification / middleware; see [Clerk Dashboard](https://dashboard.clerk.com/)) |
| `CLERK_SECRET_KEY` | `@soma-os/api` | Clerk secret key (backend; keep server-side only; tenant membership checks call the Clerk Backend API) |
| `CLERK_ORG_METADATA_TENANT_KEY` | `@soma-os/api` | Optional. When **`X-Organization-Id`** is a **UUID**, the API verifies membership by paging the user’s organizations and matching **`public_metadata[<key>]`** on each org (default key **`tenant_uuid`**). Populate that metadata in Clerk so it matches **`soma_os.organizations.id`**. Ignored when the header is a Clerk **`org_…`** id. |
| `SOMA_AUTO_PROVISION_ORGANIZATIONS` | `@soma-os/api` | When set to **`1`**, a missing **`org_*`** in **`soma_os.organizations`** gets a new row (internal UUID generated) on first resolution. Off by default — unknown tenants return **403**. |

Domain tables use **`organizations.id`** (UUID FKs only). Clerk **`org_*`** values live in **`organizations.clerk_organization_id`** (`resolveOrganizationContext`).

Use **`CLERK_PUBLISHABLE_KEY`** and **`CLERK_SECRET_KEY`** in root `.env` for the API. If you still have **`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`** from a Next.js guide, **`apps/api`** maps it onto **`CLERK_PUBLISHABLE_KEY`** when the latter is empty. Restart **`pnpm … api dev`** after changing `.env`. Missing **`CLERK_PUBLISHABLE_KEY`** yields **Publishable key is missing** on **`/api/*`** routes.

The database package loads root `.env` first, then `packages/database/.env`, so local DB settings can override when needed.

## API

```bash
# from repo root
pnpm --filter @soma-os/api dev

# or from apps/api
pnpm dev
```

### curl examples

Assume the API is on **`http://localhost:3000`** (change port if `PORT` differs).

**Health (no auth):**

```bash
curl -sS http://localhost:3000/health
```

Expected: `{"status":"ok"}`. Add `-i` to see response headers, or `-w "\nHTTP %{http_code}\n"` to print the status line after the body.

**Medication update (requires Clerk JWT + org header):**

```bash
BASE_URL=http://localhost:3000
CLERK_JWT='eyJ...'   # Clerk session JWT from your test app / dashboard
ORG_ID='11111111-1111-4111-8111-111111111111'   # Must be a Clerk org id (org_…) the user belongs to, or your internal UUID with matching org `public_metadata[CLERK_ORG_METADATA_TENANT_KEY]`
MEDICATION_ID='...'  # UUID returned when you seeded the row (see below)

curl -sS -X PUT "${BASE_URL}/api/medications/${MEDICATION_ID}" \
  -H "Authorization: Bearer ${CLERK_JWT}" \
  -H "X-Organization-Id: ${ORG_ID}" \
  -H "Content-Type: application/json" \
  -d '{"medication_name":"Acetaminophen 500mg — updated sig"}'
```

Full create (SQL) → update (curl) → verify flow: [docs/medication-smoke-test.md](docs/medication-smoke-test.md) and **`scripts/medication-smoke-test.sh`**. Same flow in Postman: [docs/postman/README.md](docs/postman/README.md) — import collection + env, set JWT from **`clerk-dev`**).

**JWT + org id:** run [apps/clerk-dev](apps/clerk-dev/README.md) — the user needs a valid Clerk session JWT. **`X-Organization-Id`** can be any Clerk organization they belong to (`org_…`) or your internal UUID if the Clerk org **`public_metadata`** maps to that UUID ([Environment variables](#environment-variables)). Active org selection in Clerk only affects routing that still matches `auth.orgId ===` header (`org_…` fast path); other allowed orgs are resolved via Clerk’s Backend API.

Protected routes use `clerkMiddleware()` (already applied in `createApp`) plus `requireAuthContext` (`src/middleware/auth.ts`), which validates the Clerk session JWT and sets `req.authContext.userId`.

Organization-scoped APIs require **`X-Organization-Id`** (internal UUID = **`organizations.id`**, or Clerk **`org_…`** resolved via **`organizations.clerk_organization_id`**; see **`src/middleware/organizationContext.ts`**) and **`requireTenantMembership`**: the user must belong to that tenant in Clerk — direct org membership when **`clerk_organization_id`** is **`org_*`**, otherwise JWT org metadata must match the internal UUID (see **`CLERK_ORG_METADATA_TENANT_KEY`**). Unknown organizations: **403** (`ORGANIZATION_UNKNOWN` from resolver, or **`TENANT_ACCESS_DENIED`** from Clerk). Integration tests use **`createMedicationsApiRouter`** without tenant membership middleware (`tests/testApp.ts`).

- **Medications:** **`GET /api/medications/:id`** returns the row with **`ETag: "v{version}"`** (integer **`version`** column, not `updated_at`). **`POST /api/medications`** creates (`patient_id`, `medication_name`, optional fields); **`201`** with **`ETag`** / **`Location`**; appends **`medication_history`** (`change_type` **`create`**). **`PUT /api/medications/:id`** requires **`If-Match: "v{N}"`** matching current **`version`** (otherwise **`428`** / **`400`** / **`412`** with structured errors); on success increments **`version`**, writes prior row to **`medication_history`** (`change_type` **`update`**, **`prior_version`** = pre-update version), writes **`audit_log`**. **`DELETE`** requires **`If-Match`**; records **`medication_history`** (`change_type` **`delete`**) then **soft-deletes** the row (`deleted_at`). Apply latest **`packages/database/migrations`** (including **`010_medications_version`**, **`002`** / **`011`** on fresh installs).

## Database

**Package:** `@soma-os/database` (`packages/database/`).

All commands read **`DATABASE_URL`** from the **repository root** `.env` first, then `packages/database/.env` (see [Environment variables](#environment-variables)).

| Command | Purpose |
|---------|---------|
| **`db:ensure`** | Ensures the **logical Postgres database named in `DATABASE_URL`** exists. Connects using the rest of your URL credentials to the **maintenance database** (**`postgres`**, or **`POSTGRES_MAINTENANCE_DATABASE`**). No-op if the target DB is already the maintenance DB, or if the database already exists. Names with hyphens (e.g. `soma-os`) are created as quoted Postgres identifiers. |
| **`db:test`** | Opens a pooled connection and runs `SELECT …` — quick check that **`DATABASE_URL`** works. |
| **`migrate`** | Applies pending `packages/database/migrations/*.sql` files in sorted order inside a transaction per file; records applied filenames in **`public.schema_migrations`** on **that same database**. **Does not create the Postgres server or the logical database.** Migration **`017`** renames the legacy schema **`soma_ehr` → `soma_os`** on databases built before this rename (no-op otherwise). |

### Upgrade from soma-ehr (schema and `DATABASE_URL`)

Two ideas are easy to confuse:

- **Postgres schema** (namespace for tables): was **`soma_ehr`**, now **`soma_os`**. After you pull these changes, run **`pnpm --filter @soma-os/database migrate`**. **`017`** performs **`ALTER SCHEMA soma_ehr RENAME TO soma_os`** on the database named in **`DATABASE_URL`**, whenever the legacy schema still exists.
- **Logical database name** (the path segment in **`DATABASE_URL`**, e.g. `…5432/soma_os`): independent of the schema rename. Compose now defaults **`POSTGRES_DB`** to **`soma_os`** for **new** volumes only. An existing Docker volume was initialized once; it still contains whatever database name it was created with (often **`soma_ehr`**), and changing **`compose.yml` does not rename that database.

**Practical checklist**

1. Point **`DATABASE_URL`** at the database you actually use (open **`psql`** or check how the container was first created).
2. Run **`migrate`** so **`017`** runs; your tables should live under **`soma_os.*`** afterward.
3. If you want the **default** dev database to be **`soma_os`** and you are fine losing local data: **`docker compose down -v`**, then **`docker compose up -d`** and **`migrate`** again (or run **`pnpm dev:stack`** as described under **Docker Compose + dev stack (recommended)** earlier in this readme).

Recommended order **on a new machine**:

```bash
pnpm --filter @soma-os/database db:ensure   # skip if DATABASE_URL ends with …/postgres and that DB exists
pnpm --filter @soma-os/database db:test
pnpm --filter @soma-os/database migrate
```

Same targets from **`packages/database`**:

```bash
pnpm db:ensure
pnpm db:test
pnpm migrate
```

Migrations run in order (sorted by filename) inside a transaction per file. Add new files such as `002_description.sql`.

## Workspace commands

Use `pnpm --filter <package-name> <script>` from the repo root, or `cd` into a package and run `pnpm <script>` there.
