#!/usr/bin/env bash
set -euo pipefail

# Run only after the Storage/Prisma-aware code has been deployed to the VPS
# worker. It switches the worker from the legacy PostgreSQL cluster to the
# isolated Danfe schema in the self-hosted Supabase.

APP_DIR="${DANFE_APP_DIR:-/home/danfe/htdocs/danfe.newgrup.cloud}"
ENV_FILE="$APP_DIR/.env"
DATABASE_SECRET="${DANFE_DATABASE_SECRET:-/home/danfe/.secrets/danfe_prisma_database.env}"
STORAGE_TOKEN="${DANFE_STORAGE_TOKEN:-/home/danfe/.secrets/danfe_supabase_api.jwt}"

for file in "$ENV_FILE" "$DATABASE_SECRET" "$STORAGE_TOKEN"; do
  if [[ ! -r "$file" ]]; then
    echo "Arquivo necessario nao encontrado: $file" >&2
    exit 1
  fi
done

database_url="$(grep '^DANFE_DATABASE_URL=' "$DATABASE_SECRET" | head -n 1 | cut -d= -f2-)"
storage_key="$(cat "$STORAGE_TOKEN")"
if [[ ! "$database_url" =~ ^postgresql://danfe_prisma\. ]] || [[ -z "$storage_key" ]]; then
  echo 'Credenciais do worker Danfe invalidas.' >&2
  exit 1
fi

stamp="$(date +%Y%m%d%H%M%S)"
cp -p "$ENV_FILE" "$ENV_FILE.before-supabase-$stamp"
tmp="$(mktemp "$APP_DIR/.env.supabase.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

grep -Ev '^(DATABASE_URL|DANFE_SUPABASE_URL|DANFE_SUPABASE_KEY|AUTH_SECRET)=' "$ENV_FILE" > "$tmp" || true
printf '\nDATABASE_URL=%s\n' "$database_url" >> "$tmp"
printf 'DANFE_SUPABASE_URL=https://db.newgrup.cloud\n' >> "$tmp"
printf 'DANFE_SUPABASE_KEY=%s\n' "$storage_key" >> "$tmp"

auth_secret="$(grep '^AUTH_SECRET=' "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '"')"
if [[ ${#auth_secret} -lt 32 ]]; then
  auth_secret="$(openssl rand -hex 48)"
fi
printf 'AUTH_SECRET=%s\n' "$auth_secret" >> "$tmp"

chown danfe:danfe "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$ENV_FILE"
trap - EXIT

echo 'DANFE_WORKER_SUPABASE_ENV_CONFIGURED=yes'
echo 'Reinicie o PM2 somente depois de npm run build concluir.'
