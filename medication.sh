#!/usr/bin/env bash
# Smoke test: PUT /api/medications/:id
# Fill in vars, then run: bash medication.sh
#
# JWT must be the raw token ONLY (often starts with eyJ...). Paste one line —
# line breaks corrupt the JWT. Never put CLERK_JWT=... inside Authorization.

# MEDICATION_ID=49c32818-740f-4031-a968-1fb81b056b87 

set -euo pipefail

CLERK_JWT='eyJhbGciOiJSUzI1NiIsImNhdCI6ImNsX0I3ZDRQRDExMUFBQSIsImtpZCI6Imluc18zREdWVE1LWm5CN1lqUkxGSWM4ekVIcDlFZGciLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwOi8vbG9jYWxob3N0OjUxNzMiLCJleHAiOjE3NzgwMDU3ODcsImZ2YSI6WzExNDAsLTFdLCJpYXQiOjE3NzgwMDU3MjcsImlzcyI6Imh0dHBzOi8vYWJvdmUtamFndWFyLTU5LmNsZXJrLmFjY291bnRzLmRldiIsIm5iZiI6MTc3ODAwNTcxNywic2lkIjoic2Vzc18zREhTMUVkNkkxOEZBcldlcko4UWd3cXBhSDciLCJzdHMiOiJhY3RpdmUiLCJzdWIiOiJ1c2VyXzNESFMxM2tvaU5ZUXVGTFBnWFA0Zk1DaFpRSSIsInYiOjJ9.sL0Ayr6Pw4c1mjZE9uEugOXXVf3LLPfy7VOadYLq9wKiFLjwTfvkohiMSRkPad7nEhp7u-OK5zUM9Fw5Yy9BspCp0Y2wqsdy8MNTyuFv0WMhN2a2d0T7cevDN5veh5uawmSZlqRzTmAdpFczdlojKIh5dPFjbi91C4zmNXFbwcOhHrbwYLumlxvy9Jig9ZQJoaYnx4uDp3e0gQYiSTxqpIWUBZIwkUO_gxgq7nhvPIFNUHNdn5QTQCCjY1Hb3ykIIxhMeoE5OPDO602dFYhIRMhDw2IeUoyNEUboVmJ4FghykLeiJBtosfRJALyfQRptknSEKhS8mP5YjkoXY6AHjA'
ORG_ID='11111111-1111-4111-8111-111111111111'
MEDICATION_ID='bea354aa-7f04-40b9-87a8-9d9f89dd3d65'

BASE_URL="${BASE_URL:-http://localhost:3000}"

JWT="$(echo -n "${CLERK_JWT:?Set CLERK_JWT in this file}" | tr -d '[:space:]')"
ORG="$(echo -n "${ORG_ID:?}" | tr -d '[:space:]')"
MID="$(echo -n "${MEDICATION_ID:?}" | tr -d '[:space:]')"

# Basic shape check (JWT = header.payload.signature, each base64url)
dots="${JWT//[^.]}"
if ((${#dots} != 2)); then
  echo >&2 "Error: JWT should have exactly 3 dot-separated parts (counted ${#dots} dots)."
  exit 1
fi

curl -sS -w  '\nHTTP %{http_code}\n' -X PUT "${BASE_URL}/api/medications/${MID}" \
  -H "Authorization: Bearer ${JWT}" \
  -H "X-Organization-Id: ${ORG}" \
  -H "Content-Type: application/json" \
  -d '{"medication_name":"Acetaminophen 500mg -- updated sig"}'
