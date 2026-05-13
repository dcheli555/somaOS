#!/usr/bin/env bash
# Medications API smoke: POST -> GET -> PUT -> GET -> DELETE
#
# Prerequisites: jq, curl. API running; valid Clerk Bearer token.
# ORG_ID: internal tenant UUID sent as X-Organization-Id, or Clerk org_* if your middleware resolves it.
#
# Usage:
#   export CLERK_JWT='eyJ...'
#   export ORG_ID='11111111-1111-4111-8111-111111111111'   # or org_...
#   bash medication.sh
#
# Optional: PATIENT_ID, ENCOUNTER_ID, BASE_URL

set -euo pipefail

# Optional — paste locally (do not commit real tokens):
CLERK_JWT='eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zREdWVE1LWm5CN1lqUkxGSWM4ekVIcDlFZGciLCJvaWF0IjoxNzc4Njk2NTQ0LCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjUxNzMiLCJleHAiOjE3Nzg2OTY2MDQsImZ2YSI6WzAsLTFdLCJpYXQiOjE3Nzg2OTY1NDQsImlzcyI6Imh0dHBzOi8vYWJvdmUtamFndWFyLTU5LmNsZXJrLmFjY291bnRzLmRldiIsIm5iZiI6MTc3ODY5NjUzNCwibyI6eyJpZCI6Im9yZ18zRE1UN2pCVmVUcVhYT2ZRWDhUczdhYzR4b1UiLCJyb2wiOiJtZW1iZXIiLCJzbGciOiJzb21hZWhyLWRldi0xNzc4MDkwNzczODcyNDgzOTkwIn0sInNpZCI6InNlc3NfM0RnR3hIZUFIdlVPSVlrOGJGUldzMUtVVnRoIiwic3RzIjoiYWN0aXZlIiwic3ViIjoidXNlcl8zREhTMTNrb2lOWVF1RkxQZ1hQNGZNQ2haUUkiLCJ2IjoyfQ.cpFIwayacETKe9nZpDJ36fnjdIE5Q3ugLnEO5NVrBUSCbXd7NKm5V6zJwqXYKDZKiFi7-yZIt1KEe33D5YCVAAuIyal8I03dIbEd9Fs34fPKwJnRtHVZlTR5bm0LfpfByHtf82wQRJ_uwx_pCzkKKkqa3rDUausXJHO-U8FxMbyyXbi_ZeLpe0vJelEKsSfpA69kYZtsIK6uMHq8SJHFq9cAxDykEEBlgqbiqzNfsmPTN1TylOAW5b1-pzee9avtT2R3vsCOr4fKM-jes8KWbpJSWY5HPQizibH0MjJYphn8KMyE-634lEhy6Mqrt9aS2yJXGcdiMeJJzCx4oWWy-w'
ORG_ID='org_3DMT7jBVeTqXXOfQX8Ts7ac4xoU'

: "${CLERK_JWT:?Set CLERK_JWT — export env or uncomment assignment above}"
: "${ORG_ID:?Set ORG_ID — export env or uncomment assignment above}"

BASE_URL="${BASE_URL:-http://localhost:3000}"
PATIENT_ID="${PATIENT_ID:-33322222-2222-4222-8222-222222222222}"
ENCOUNTER_ID="${ENCOUNTER_ID:-a0000001-0000-4000-8000-000000000001}"

JWT="$(echo -n "${CLERK_JWT}" | tr -d '[:space:]')"
ORG="$(echo -n "${ORG_ID}" | tr -d '[:space:]')"
API="${BASE_URL}/api"

# Basic shape check (JWT = header.payload.signature, each base64url)
dots="${JWT//[^.]}"
if ((${#dots} != 2)); then
  echo >&2 "Error: JWT should have exactly 3 dot-separated parts (counted ${#dots} dots)."
  exit 1
fi

needs_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo >&2 "Missing required command: $1"
    exit 1
  }
}

needs_cmd curl
needs_cmd jq

WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/med-smoke.XXXXXX")"
trap 'rm -rf "${WORKDIR}"' EXIT

HDR="${WORKDIR}/headers.txt"
BODY="${WORKDIR}/body.txt"

etag_from_headers() {
  # Last ETag wins (curl may write CONNECT headers on redirects).
  grep -i '^etag:' "${HDR}" | tr -d '\r' | tail -n1 | awk '{ $1=""; sub(/^ */, ""); print }'
}

req_headers=(
  -H "Authorization: Bearer ${JWT}"
  -H "X-Organization-Id: ${ORG}"
)

echo ""
echo "=== 1. POST ${API}/medications ==="
POST_JSON="$(
  jq -n \
    --arg patient_id "${PATIENT_ID}" \
    --arg encounter_id "${ENCOUNTER_ID}" \
    '{
      patient_id: $patient_id,
      encounter_id: $encounter_id,
      medication_name: "Smoke hydroCHLOROthiazide",
      ndc_10: "23155-764-01",
      dose_text: "25MG",
      route: "oral",
      form: "tablet",
      strength: "25MG",
      frequency_text: "1 tablet per day",
      sig_text: "1 tablet per day",
      status: "active",
      start_at: "2026-01-01T00:00:00Z",
      end_at: "2026-12-31T23:59:59Z",
      metadata: {
        source: "smoke_test",
      }
    }'
)"

rm -f "${HDR}" "${BODY}"
code="$(
  curl -sS -o "${BODY}" -D "${HDR}" -w "%{http_code}" "${req_headers[@]}" \
    -H "Content-Type: application/json" \
    -X POST "${API}/medications" \
    -d "${POST_JSON}"
)"

echo "HTTP ${code}"
if [[ "${code}" != "201" ]]; then
  cat "${BODY}" >&2
  echo >&2 "Expected 201 Created"
  exit 1
fi

MEDICATION_ID="$(jq -r '.id' "${BODY}")"
VERSION="$(jq -r '.version' "${BODY}")"
ETAG="$(etag_from_headers)"
echo "Medication id=${MEDICATION_ID} version=${VERSION} etag=${ETAG}"

echo ""
echo "=== 2. GET ${API}/medications/${MEDICATION_ID} ==="
rm -f "${HDR}" "${BODY}"
code="$(
  curl -sS -o "${BODY}" -D "${HDR}" -w "%{http_code}" "${req_headers[@]}" \
    -X GET "${API}/medications/${MEDICATION_ID}"
)"
echo "HTTP ${code}"
jq . "${BODY}"
[[ "${code}" == "200" ]] || exit 1
ETAG="$(etag_from_headers)"
echo "(ETag ${ETAG})"

echo ""
echo "=== 3. PUT ${API}/medications/${MEDICATION_ID} ==="
rm -f "${HDR}" "${BODY}"
code="$(
  curl -sS -o "${BODY}" -D "${HDR}" -w "%{http_code}" "${req_headers[@]}" \
    -H "Content-Type: application/json" \
    -H "If-Match: ${ETAG}" \
    -X PUT "${API}/medications/${MEDICATION_ID}" \
    -d '{"dose_text":"12.5MG","rxnorm_cui":"429503", "strength": "12.5MG"}'
)"
echo "HTTP ${code}"
if [[ "${code}" != "200" ]]; then
  cat "${BODY}" >&2
  exit 1
fi
jq . "${BODY}"
ETAG="$(etag_from_headers)"
VERSION="$(jq -r '.version' "${BODY}")"
echo "Updated version=${VERSION} etag=${ETAG}"

echo ""
echo "=== 4. GET ${API}/medications/${MEDICATION_ID} (after PUT) ==="
rm -f "${HDR}" "${BODY}"
code="$(
  curl -sS -o "${BODY}" -D "${HDR}" -w "%{http_code}" "${req_headers[@]}" \
    -X GET "${API}/medications/${MEDICATION_ID}"
)"
echo "HTTP ${code}"
jq . "${BODY}"
[[ "${code}" == "200" ]] || exit 1
ETAG="$(etag_from_headers)"
echo "(ETag ${ETAG})"

echo ""
echo "=== 5. DELETE ${API}/medications/${MEDICATION_ID} ==="
rm -f "${HDR}" "${BODY}"
code="$(
  curl -sS -o "${BODY}" -D "${HDR}" -w "%{http_code}" "${req_headers[@]}" \
    -H "If-Match: ${ETAG}" \
    -X DELETE "${API}/medications/${MEDICATION_ID}"
)"
echo "HTTP ${code}"
if [[ "${code}" != "204" ]]; then
  [[ -s "${BODY}" ]] && cat "${BODY}" >&2
  exit 1
fi
echo "=== 6. GET ${API}/medications/${MEDICATION_ID} (after PUT) ==="
rm -f "${HDR}" "${BODY}"
code="$(
  curl -sS -o "${BODY}" -D "${HDR}" -w "%{http_code}" "${req_headers[@]}" \
    -X GET "${API}/medications/${MEDICATION_ID}"
)"
echo "HTTP ${code}"
jq . "${BODY}"
[[ "${code}" == "200" ]] || exit 1
ETAG="$(etag_from_headers)"
echo "(ETag ${ETAG})"
echo "Done."
