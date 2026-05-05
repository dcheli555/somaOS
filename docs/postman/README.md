# Postman — medication smoke test

Import into **Postman** (File → Import, or drag-and-drop):

| File | Role |
|------|------|
| [`soma-ehr-medication-smoke.postman_collection.json`](./soma-ehr-medication-smoke.postman_collection.json) | Collection (health + PUT medication) |
| [`soma-ehr-local.postman_environment.json`](./soma-ehr-local.postman_environment.json) | Local environment variables (optional) |

After import, choose the **environment** “Soma EHR — local dev”.

## Variables

| Variable | Where to set | Notes |
|---------|----------------|-------|
| `clerk_session_jwt` | Collection **Variables** or Environment | Paste **session JWT** only (starts with `eyJ…`). Get it from **`apps/clerk-dev`** (`pnpm --filter @soma-ehr/clerk-dev dev` → sign in → **Refresh JWT / Copy**). Do not paste the publishable key here. Mark as secret in Postman. |
| `medication_id` | Same | UUID from **`INSERT … RETURNING id`** ([medication smoke test](../medication-smoke-test.md)). |
| `organization_id` | Same | Must match **`medications.organization_id`** in seed SQL and **`X-Organization-Id`**. Default matches the doc example. |
| `base_url` | Same | Usually `http://localhost:3000`. |

Postman cannot perform the Clerk hosted sign-in dance for you; use **`clerk-dev`** (or paste a JWT from **`getToken()`** in any Clerk-enabled app targeting the **same Clerk instance** as the API).

## Run order

1. API running: **`pnpm --filter @soma-ehr/api dev`**
2. Migrations applied; medication row seeded
3. **Health** request → expect `200`, `{\"status\":\"ok\"}`
4. **Medication — PUT update** → expect `200` and updated JSON

If **`clerk_session_jwt`** is empty, the collection **pre-request script** stops the PUT with a clear error.
