#!/usr/bin/env bash
# Smoke test: PUT /api/medications/:id
# Fill in vars, then run: bash medication.sh
#
# JWT must be the raw token ONLY (often starts with eyJ...). Paste one line —
# line breaks corrupt the JWT. Never put CLERK_JWT=... inside Authorization.

# MEDICATION_ID=49c32818-740f-4031-a968-1fb81b056b87 

set -euo pipefail

CLERK_JWT='eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zREdWVE1LWm5CN1lqUkxGSWM4ekVIcDlFZGciLCJvaWF0IjoxNzc4NjMxMjgyLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjUxNzMiLCJleHAiOjE3Nzg2MzEzNDIsImZ2YSI6Wzg5OTUsLTFdLCJpYXQiOjE3Nzg2MzEyODIsImlzcyI6Imh0dHBzOi8vYWJvdmUtamFndWFyLTU5LmNsZXJrLmFjY291bnRzLmRldiIsIm5iZiI6MTc3ODYzMTI3MiwibyI6eyJpZCI6Im9yZ18zRE1UN2pCVmVUcVhYT2ZRWDhUczdhYzR4b1UiLCJyb2wiOiJtZW1iZXIiLCJzbGciOiJzb21hZWhyLWRldi0xNzc4MDkwNzczODcyNDgzOTkwIn0sInNpZCI6InNlc3NfM0RNVWswQW1ZNmYycTZFZTdHZ2MxckZKd2RlIiwic3RzIjoiYWN0aXZlIiwic3ViIjoidXNlcl8zREhTMTNrb2lOWVF1RkxQZ1hQNGZNQ2haUUkiLCJ2IjoyfQ.RZxwnaczFdgex_i23ikezYNGtHv8j6LM7zyMDsG3m80GhKSWPm6TnyKrWoxTFG0zJy-y4kwIJ77VtUZbA8IP3mhC2cFOvKR4i6NdSG3Ymx6OYl2daNOEIXzFt9OlYT07kd0fwBZQlWADccstvpk9vzagg97ueIqfmxWr4Uhqvig1dFILb3dlgg7AbaQIEYBZs4_NJR6-VDJD_gUrNQtUgrAG1CEbeDULMVSNp_Uy09d9QMxc0JHNObOjPEGCjwuuYEZPYaywjSAjgFEtQamjHM2NSnMUcVNo9kGNpRkC-8DkO2TIs7-fIv9MQxpBK0ieDz3uY32ihd5YbbiKW_q6TA'
# ORG_ID='11111111-1111-4111-8111-111111111111'
ORG_ID='org_3DMT7jBVeTqXXOfQX8Ts7ac4xoU'

MEDICATION_ID='e5da7552-7f54-4160-abe2-8bc26078f001'

BASE_URL="${BASE_URL:-http://localhost:3000}"

JWT="$(echo -n "${CLERK_JWT:?Set CLERK_JWT in this file}" | tr -d '[:space:]')"
ORG="$(echo -n "${ORG_ID:?}" | tr -d '[:space:]')"
MID="$(echo -n "${MEDICATION_ID:?}" | tr -d '[:space:]')"


# curl -sS -i -X POST "${BASE_URL:-http://localhost:3000}/api/medications" \
#   -H "Authorization: Bearer ${JWT}" \
#   -H "X-Organization-Id: ${ORG}" \
#   -H "Content-Type: application/json" \
#   -d '{
#     "patient_id": "22222222-2222-4222-8222-222222222222",
#     "medication_name": "Acetaminophen 500mg tablet"
#   }'


curl -sS -i \
  -H "Authorization: Bearer ${JWT}" \
  -H "X-Organization-Id: ${ORG}" \
  "${BASE_URL}/api/medications/${MID}"

# Basic shape check (JWT = header.payload.signature, each base64url)
dots="${JWT//[^.]}"
if ((${#dots} != 2)); then
  echo >&2 "Error: JWT should have exactly 3 dot-separated parts (counted ${#dots} dots)."
  exit 1
fi

# curl -sS -w  '\nHTTP %{http_code}\n' -X PUT "${BASE_URL}/api/medications/${MID}" \
#   -H "Authorization: Bearer ${JWT}" \
#   -H "X-Organization-Id: ${ORG}" \
#   -H "Content-Type: application/json" \
#   -H 'If-Match: "v1"' \
  # -d '{"medication_name":"MY_Acetaminophen 200mg -- updated sig"}'
