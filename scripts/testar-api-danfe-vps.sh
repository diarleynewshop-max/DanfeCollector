#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${SUPABASE_ENV_FILE:-/opt/supabase/.env}"
TOKEN_FILE="${DANFE_TOKEN_FILE:-/home/danfe/.secrets/danfe_supabase_api.jwt}"
URL="${SUPABASE_URL:-http://127.0.0.1:8000}/rest/v1/Cnpj?select=id&limit=1"

service_key="$(grep '^SERVICE_ROLE_KEY=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
danfe_key="$(cat "$TOKEN_FILE")"

status() {
  local key="$1"
  curl -sS -o /dev/null -w '%{http_code}' \
    -H "apikey: $key" \
    -H "Authorization: Bearer $key" \
    -H 'Accept-Profile: danfe' \
    "$URL"
}

echo "SERVICE_ROLE_STATUS=$(status "$service_key")"
echo "DANFE_ROLE_STATUS=$(status "$danfe_key")"
