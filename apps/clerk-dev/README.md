# clerk-dev — minimal UI for Phase 3 API testing

Vite + React + Clerk for copying:

- **`CLERK_JWT`** — Clerk session token → `Authorization: Bearer …`
- **`X-Organization-Id`** — dev tenant UUID (must match seeded `medications.organization_id`)

## Setup

1. In the [Clerk Dashboard](https://dashboard.clerk.com/) for **the same application** as `@soma-os/api`, add **`http://localhost:5173`** under allowed origins / redirect URLs (exact dev URL Vite uses).
2. Copy env:

   ```bash
   cp apps/clerk-dev/.env.example apps/clerk-dev/.env
   ```

   Set **`VITE_CLERK_PUBLISHABLE_KEY`** (same publishable key as `CLERK_PUBLISHABLE_KEY` in repo root `.env`, or paste from Clerk **API Keys**).

3. From repo root:

   ```bash
   pnpm install
   pnpm --filter @soma-os/clerk-dev dev
   ```

4. Open **http://localhost:5173** → Sign in → **Refresh JWT** / **Copy**. Use **Copy org UUID** with the medication smoke-test SQL (`docs/medication-smoke-test.md`).

The API continues to run with **`pnpm --filter @soma-os/api dev`** on port **3000**.
