#!/usr/bin/env bash
# Smoke test: PUT /api/medications/:id
# Fill in vars, then run: bash medication.sh
#
# JWT must be the raw token ONLY (often starts with eyJ...). Paste one line —
# line breaks corrupt the JWT. Never put CLERK_JWT=... inside Authorization.

# MEDICATION_ID=49c32818-740f-4031-a968-1fb81b056b87 

set -euo pipefail

CLERK_JWT='eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zREdWVE1LWm5CN1lqUkxGSWM4ekVIcDlFZGciLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjUxNzMiLCJleHAiOjE3NzgwOTQ1OTgsImZ2YSI6WzQ5LC0xXSwiaWF0IjoxNzc4MDk0NTM4LCJpc3MiOiJodHRwczovL2Fib3ZlLWphZ3Vhci01OS5jbGVyay5hY2NvdW50cy5kZXYiLCJuYmYiOjE3NzgwOTQ1MjgsIm8iOnsiaWQiOiJvcmdfM0RNVDdqQlZlVHFYWE9mUVg4VHM3YWM0eG9VIiwicm9sIjoibWVtYmVyIiwic2xnIjoic29tYWVoci1kZXYtMTc3ODA5MDc3Mzg3MjQ4Mzk5MCJ9LCJzaWQiOiJzZXNzXzNETVVrMEFtWTZmMnE2RWU3R2djMXJGSndkZSIsInN0cyI6ImFjdGl2ZSIsInN1YiI6InVzZXJfM0RIUzEza29pTllRdUZMUGdYUDRmTUNoWlFJIiwidiI6Mn0.DjY5LWqQa4oBli9D2xhByi_HnAkphCbYHgiNnz7_07ylUop0Sm5FoRe2n2IN9S5TDdppbMwglsn5IAJU0nqNU5Agv74lj3Ycs_QN69qxz0dpRuXINpp7rwEY2yA5OHMtCA9Z2g953eGstdW5CWOXxgqsZwnEm3PIUvM--UZgQcYUmahyBPxMO5vvoJnv1nxdINNFDMvwx6T-57OdboULn3fpgeKi4HT45RnCi3o8g2v-zn9PsdV0dSEcn1YaNC5HHYyXBk1VHzYI4uYJBdTK4T3CENosh685dv8z0ZK1BdnrgksuPXAkPZpENNgTHhx2cQLU8GoOVYFpKXAtGIr5Nw'
# ORG_ID='11111111-1111-4111-8111-111111111111'
ORG_ID='org_3DMT7jBVeTqXXOfQX8Ts7ac4xoU'
MEDICATION_ID='bea354aa-7f04-40b9-87a8-9d9f89dd3d65'

BASE_URL="${BASE_URL:-http://localhost:3000}"

JWT="$(echo -n "${CLERK_JWT:?Set CLERK_JWT in this file}" | tr -d '[:space:]')"
ORG="$(echo -n "${ORG_ID:?}" | tr -d '[:space:]')"
MID="$(echo -n "${MEDICATION_ID:?}" | tr -d '[:space:]')"


curl -sS -i -X POST "${BASE_URL:-http://localhost:3000}/api/medications" \
  -H "Authorization: Bearer ${JWT}" \
  -H "X-Organization-Id: ${ORG}" \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "22222222-2222-4222-8222-222222222222",
    "medication_name": "Acetaminophen 500mg tablet"
  }'


# curl -sS -i \
#   -H "Authorization: Bearer ${JWT}" \
#   -H "X-Organization-Id: ${ORG}" \
#   "${BASE_URL}/api/medications/${MID}"

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
