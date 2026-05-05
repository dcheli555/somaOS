# Medication create → update → verify

End-to-end check that **`medications`**, **`medication_history`**, and **`audit_log`** behave as expected.

## Prerequisites

1. **Postgres** running; **`DATABASE_URL`** set (see repo root `.env`).
2. **Migrations applied** (latest `packages/database/migrations/`):  
   `pnpm --filter @soma-ehr/database migrate`
3. **API running** (e.g. `pnpm --filter @soma-ehr/api dev`) with **`CLERK_PUBLISHABLE_KEY`** and **`CLERK_SECRET_KEY`**.
4. A **Clerk session JWT** for a test user (**Bearer** token).
5. A test **`organization_id`** UUID that you will send as **`X-Organization-Id`** and use when inserting the medication (must match).

Optional: run the automated script (see below) after exporting env vars.

---

## 1. Create a medication (SQL)

The API currently exposes **PUT** for updates only, so seed one row with **`psql`** (or any SQL client):

```sql
-- Use the SAME organization UUID you will send in X-Organization-Id
INSERT INTO soma_ehr.medications (
  organization_id,
  patient_id,
  medication_name,
  status,
  created_by,
  updated_by
) VALUES (
  '11111111-1111-4111-8111-111111111111'::uuid,
  '22222222-2222-4222-8222-222222222222'::uuid,
  'Acetaminophen 500mg',
  'active',
  'manual_seed',
  'manual_seed'
)
RETURNING id, organization_id, patient_id;
```

Copy the returned **`id`** as **`MEDICATION_ID`**.

---

## 2. Update via API (curl)

Replace placeholders:

- **`BASE_URL`**: e.g. `http://localhost:3000`
- **`CLERK_JWT`**: valid `Authorization: Bearer` token
- **`ORG_ID`**: same UUID as **`organization_id`** in the insert (example uses `11111111-...`)
- **`MEDICATION_ID`**: UUID from **RETURNING id**

```bash
curl -sS -X PUT "${BASE_URL}/api/medications/${MEDICATION_ID}" \
  -H "Authorization: Bearer ${CLERK_JWT}" \
  -H "X-Organization-Id: ${ORG_ID}" \
  -H "Content-Type: application/json" \
  -d '{"medication_name":"Acetaminophen 500mg — updated sig"}'
```

You should get **HTTP 200** and a JSON body with the **updated** medication (new **`updated_at`**, new name).

**Postman**

- Method: **PUT**
- URL: `{{baseUrl}}/api/medications/{{medicationId}}`
- Headers:
  - `Authorization`: `Bearer {{clerkJwt}}`
  - `X-Organization-Id`: `{{orgId}}` (UUID, must match row)
  - `Content-Type`: `application/json`
- Body (raw JSON), example:

```json
{
  "medication_name": "Acetaminophen 500mg — updated sig"
}
```

---

## 3. Verify in the database

Run with **`psql "$DATABASE_URL"`**, substituting **`MEDICATION_ID`**:

```sql
-- A) medications row updated
SELECT id, medication_name, updated_at
FROM soma_ehr.medications
WHERE id = 'MEDICATION_ID'::uuid;

-- B) medication_history: prior snapshot (should include OLD name in snapshot JSON)
SELECT id, medication_id,
       snapshot->>'medication_name' AS snapshot_name,
       correlation_request_id,
       created_at
FROM soma_ehr.medication_history
WHERE medication_id = 'MEDICATION_ID'::uuid
ORDER BY created_at DESC;

-- C) audit_log: update event (outcome, event_type, metadata)
SELECT id, event_type, action, outcome, resource_type, resource_id, request_id,
       "timestamp",
       metadata->>'domain' AS metadata_domain
FROM soma_ehr.audit_log
WHERE resource_id = 'MEDICATION_ID'::uuid
ORDER BY "timestamp" DESC
LIMIT 5;
```

**Expectations**

- **(A)** `medication_name` matches the **PUT** body; **`updated_at`** is newer than **`created_at`**.
- **(B)** At least **one** history row; **`snapshot_name`** is the **previous** label (before update).
- **(C)** At least one row with **`action` = `update`**, **`event_type` = `medication.update`**, **`outcome` = `success`**, **`resource_type` = `medication`**; **`request_id`** ties to **`x-request-id`**.

---

## Automated script

From the **repository root** (requires **`psql`**, **`curl`**, **`DATABASE_URL`**, **`CLERK_JWT`**, **`ORG_ID`**; optional **`PATIENT_ID`**, **`API_BASE`**):

```bash
export DATABASE_URL='postgres://...'
export CLERK_JWT='eyJ...'
export ORG_ID='11111111-1111-4111-8111-111111111111'
# optional: export PATIENT_ID='22222222-2222-4222-8222-222222222222'
# optional: export API_BASE='http://localhost:3000'

bash scripts/medication-smoke-test.sh
```

The script inserts a baseline medication, performs the **PUT**, then prints the three verification queries.
