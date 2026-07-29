#!/usr/bin/env bash
set -euo pipefail

# Configures the self-hosted Supabase REST API to expose only the isolated
# Danfe schema to a dedicated role. Run on the VPS as root.

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
ENV_FILE="$SUPABASE_DIR/.env"
TOKEN_DIR="${DANFE_TOKEN_DIR:-/home/danfe/.secrets}"
TOKEN_FILE="$TOKEN_DIR/danfe_supabase_api.jwt"
SCHEMAS="public,danfe,storage,graphql_public"
KONG_CONFIG="$SUPABASE_DIR/volumes/api/kong.yml"
COMPOSE_FILE="$SUPABASE_DIR/docker-compose.yml"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Ambiente do Supabase nao encontrado: $ENV_FILE" >&2
  exit 1
fi

if ! grep -q '^JWT_SECRET=' "$ENV_FILE"; then
  echo 'JWT_SECRET ausente no .env do Supabase.' >&2
  exit 1
fi

backup="$SUPABASE_DIR/.env.before-danfe-schema-$(date +%Y%m%d%H%M%S)"
cp -p "$ENV_FILE" "$backup"
cp -p "$KONG_CONFIG" "$KONG_CONFIG.before-danfe-schema-$(date +%Y%m%d%H%M%S)"
cp -p "$COMPOSE_FILE" "$COMPOSE_FILE.before-danfe-schema-$(date +%Y%m%d%H%M%S)"

if grep -q '^PGRST_DB_SCHEMAS=' "$ENV_FILE"; then
  sed -i "s|^PGRST_DB_SCHEMAS=.*|PGRST_DB_SCHEMAS=$SCHEMAS|" "$ENV_FILE"
else
  printf '\nPGRST_DB_SCHEMAS=%s\n' "$SCHEMAS" >> "$ENV_FILE"
fi

jwt_secret="$(grep '^JWT_SECRET=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
if [[ -z "$jwt_secret" ]]; then
  echo 'JWT_SECRET vazio.' >&2
  exit 1
fi

b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

agora="$(date +%s)"
expira="$((agora + 31536000))"
cabecalho="$(printf '%s' '{"alg":"HS256","typ":"JWT"}' | b64url)"
payload="$(printf '{"role":"danfe_api","iss":"supabase","iat":%s,"exp":%s}' "$agora" "$expira" | b64url)"
assinatura="$(printf '%s' "$cabecalho.$payload" | openssl dgst -binary -sha256 -hmac "$jwt_secret" | b64url)"

install -d -m 700 -o danfe -g danfe "$TOKEN_DIR"
umask 077
printf '%s.%s.%s' "$cabecalho" "$payload" "$assinatura" > "$TOKEN_FILE"
chown danfe:danfe "$TOKEN_FILE"
chmod 600 "$TOKEN_FILE"

if grep -q '^DANFE_SUPABASE_KEY=' "$ENV_FILE"; then
  sed -i "s|^DANFE_SUPABASE_KEY=.*|DANFE_SUPABASE_KEY=$cabecalho.$payload.$assinatura|" "$ENV_FILE"
else
  printf '\nDANFE_SUPABASE_KEY=%s.%s.%s\n' "$cabecalho" "$payload" "$assinatura" >> "$ENV_FILE"
fi

python3 "$SCRIPT_DIR/configurar-kong-danfe.py" "$KONG_CONFIG" "$COMPOSE_FILE"

cd "$SUPABASE_DIR"
docker compose up -d --force-recreate --no-deps rest kong >/dev/null

# Kong starts after the containers are recreated. A 401 is an acceptable
# response here; this loop waits only for the local TCP/HTTP listener.
api_ready=false
for _ in {1..30}; do
  if curl -sS --max-time 2 -o /dev/null 'http://127.0.0.1:8000/rest/v1/'; then
    api_ready=true
    break
  fi
  sleep 1
done

if [[ "$api_ready" != true ]]; then
  echo 'Kong nao ficou disponivel apos o reinicio.' >&2
  exit 1
fi

token="$(cat "$TOKEN_FILE")"
status="$({ curl -sS -o /tmp/danfe-rest-api-check.json -w '%{http_code}' \
  -H "apikey: $token" \
  -H "Authorization: Bearer $token" \
  -H 'Accept-Profile: danfe' \
  'http://127.0.0.1:8000/rest/v1/Cnpj?select=id&limit=1'; } || true)"
rm -f /tmp/danfe-rest-api-check.json

if [[ "$status" != '200' ]]; then
  echo "Falha ao validar a API Danfe: HTTP $status" >&2
  exit 1
fi

echo "DANFE_REST_STATUS=$status"
echo "DANFE_API_TOKEN_FILE=$TOKEN_FILE"
echo "DANFE_API_TOKEN_EXPIRES_AT=$(date -u -d "@$expira" +%Y-%m-%dT%H:%M:%SZ)"
