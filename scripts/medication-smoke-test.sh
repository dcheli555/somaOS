#!/usr/bin/env bash
# Create a medication via SQL, update via API, print verification SQL results.
# Usage: from repo root, set DATABASE_URL, CLERK_JWT, ORG_ID (see docs/medication-smoke-test.md)

set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL}"
: "${CLERK_JWT:?Set CLERK_JWT (Bearer token)}"
: "${ORG_ID:?Set ORG_ID (UUID; must match medication.organization_id)}"

API_BASE="${API_BASE:-http://localhost:3000}"
PATIENT_ID="${PATIENT_ID:-22222222-2222-4222-8222-222222222222}"

echo "Inserting baseline medication (org=${ORG_ID}, patient=${PATIENT_ID})..."
MED_ID="$(
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -tAc \
    "INSERT INTO soma_ehr.medications (organization_id, patient_id, medication_name, status, created_by, updated_by)
     VALUES ('${ORG_ID}'::uuid, '${PATIENT_ID}'::uuid, 'Smoke baseline med', 'active', 'smoke_test_user', 'smoke_test_user')
     RETURNING id;" | tr -d ' '
)"

if [[ -z "$MED_ID" ]]; then
  echo "Failed to insert medication" >&2
  exit 1
fi

echo "Created medication id=${MED_ID}"

echo "PUT update via API (${API_BASE})..."
HTTP_CODE="$(
  curl -sS -o /tmp/medication-smoke-response.json -w '%{http_code}' -X PUT \
    "${API_BASE}/api/medications/${MED_ID}" \
    -H "Authorization: Bearer ${CLERK_JWT}" \
    -H "X-Organization-Id: ${ORG_ID}" \
    -H "Content-Type: application/json" \
    -d '{"medication_name":"Smoke baseline med — updated"}'
)"

echo "HTTP ${HTTP_CODE}"
cat /tmp/medication-smoke-response.json
echo ""

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Update failed (expected 200)" >&2
  exit 1
fi

echo ""
echo "=== Verification: medications (expect updated name) ==="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT id, medication_name, created_at, updated_at
   FROM soma_ehr.medications WHERE id = '${MED_ID}'::uuid;"

echo ""
echo "=== Verification: medication_history (expect snapshot with OLD name) ==="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT id, snapshot->>'medication_name' AS snapshot_name, correlation_request_id, created_at
   FROM soma_ehr.medication_history
   WHERE medication_id = '${MED_ID}'::uuid
   ORDER BY created_at DESC;"

echo ""
echo "=== Verification: audit_log (expect action=update, resource=medication) ==="
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT action, resource_type, resource_id, request_id,
          context->>'requestId' AS ctx_request_id,
          context->>'eventTimestampUtc' AS event_utc_iso
   FROM soma_ehr.audit_log
   WHERE resource_id = '${MED_ID}'::uuid
   ORDER BY recorded_at DESC
   LIMIT 5;"

echo ""
echo "Done. Clean up test rows (history first — FK to medications):"
echo "  psql \"\$DATABASE_URL\" -c \"DELETE FROM soma_ehr.medication_history WHERE medication_id = '${MED_ID}'::uuid;\""
echo "  psql \"\$DATABASE_URL\" -c \"DELETE FROM soma_ehr.audit_log WHERE resource_id = '${MED_ID}'::uuid;\""
echo "  psql \"\$DATABASE_URL\" -c \"DELETE FROM soma_ehr.medications WHERE id = '${MED_ID}'::uuid;\""
