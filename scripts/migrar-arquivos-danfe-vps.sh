#!/usr/bin/env bash
set -euo pipefail

# Server-side wrapper: the global Supabase service key never leaves the VPS
# and is used only for the one-time Storage migration.

SUPABASE_ENV_FILE="${SUPABASE_ENV_FILE:-/opt/supabase/.env}"
SUPABASE_URL="${SUPABASE_URL:-http://127.0.0.1:8000}"
NODE_BIN="${NODE_BIN:-/home/danfe/.nvm/versions/node/v22.23.1/bin/node}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Node nao encontrado: $NODE_BIN" >&2
  exit 1
fi

if [[ ! -r "$SUPABASE_ENV_FILE" ]]; then
  echo "Arquivo do Supabase nao encontrado: $SUPABASE_ENV_FILE" >&2
  exit 1
fi

export SUPABASE_URL
export SUPABASE_SERVICE_ROLE_KEY
SUPABASE_SERVICE_ROLE_KEY="$(grep '^SERVICE_ROLE_KEY=' "$SUPABASE_ENV_FILE" | head -n 1 | cut -d= -f2-)"

if [[ -z "$SUPABASE_SERVICE_ROLE_KEY" ]]; then
  echo "SERVICE_ROLE_KEY ausente no ambiente do Supabase." >&2
  exit 1
fi

"$NODE_BIN" "$SCRIPT_DIR/migrar-arquivos-danfe-para-storage.mjs" "$@"
unset SUPABASE_SERVICE_ROLE_KEY
