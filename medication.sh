#!/usr/bin/env bash
# Smoke test: PUT /api/medications/:id
# Fill in vars, then run: bash medication.sh
#
# JWT must be the raw token ONLY (often starts with eyJ...). Paste one line —
# line breaks corrupt the JWT. Never put CLERK_JWT=... inside Authorization.

# MEDICATION_ID=49c32818-740f-4031-a968-1fb81b056b87 

set -euo pipefail

CLERK_JWT='eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zREdWVE1LWm5CN1lqUkxGSWM4ekVIcDlFZGciLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjUxNzMiLCJleHAiOjE3NzgxMDEwNDEsImZ2YSI6WzE1NiwtMV0sImlhdCI6MTc3ODEwMDk4MSwiaXNzIjoiaHR0cHM6Ly9hYm92ZS1qYWd1YXItNTkuY2xlcmsuYWNjb3VudHMuZGV2IiwibmJmIjoxNzc4MTAwOTcxLCJvIjp7ImlkIjoib3JnXzNETVQ3akJWZVRxWFhPZlFYOFRzN2FjNHhvVSIsInJvbCI6Im1lbWJlciIsInNsZyI6InNvbWFlaHItZGV2LTE3NzgwOTA3NzM4NzI0ODM5OTAifSwic2lkIjoic2Vzc18zRE1VazBBbVk2ZjJxNkVlN0dnYzFyRkp3ZGUiLCJzdHMiOiJhY3RpdmUiLCJzdWIiOiJ1c2VyXzNESFMxM2tvaU5ZUXVGTFBnWFA0Zk1DaFpRSSIsInYiOjJ9.qajFHFOeOCP1II1OrDDUwySxMj98dsKVHcQw7htf5B3tHE0co1a7ChJj4YDUCuhqJObxB30N_-Stb34Zg553jqPGN_FdXVTkJ8s87bz4AJZzPzsS0WWmJZ42qx9r0Q8CWPh4sEmSKAJQNOrbigrTmS5XANOHLpn7bos9bPj3qRNYmHTWnN-L4twZW4wPGkbBjGqBW9wGRfXeV13OHmIxK98i0B__856U0lO_nCoaiJVC9q0wI_up57yVFodZGSXVBHhjPPWC9r7jGAlqsNkW6tyAMuCOlDZXeq6d1tAaifqWO6PPYU-qQzOu2SK6SpJfi8rA2T2T8Ofq-f0FzGrXAA'
# ORG_ID='11111111-1111-4111-8111-111111111111'
ORG_ID='org_3DMT7jBVeTqXXOfQX8Ts7ac4xoU'

MEDICATION_ID='82367ca3-7913-4e4e-8973-15395b4f1b46'

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
