#!/usr/bin/env bash
set -euo pipefail

# Creates the least-privilege PostgreSQL login used only by the Danfe server.
# It writes the generated credential to a root/danfe-readable VPS secret file,
# never to stdout or the Git repository.

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
ENV_FILE="$SUPABASE_DIR/.env"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROLE_SQL="${DANFE_ROLE_SQL:-$SCRIPT_DIR/20260729_005_danfe_prisma_role.sql}"
SECRET_DIR="${DANFE_TOKEN_DIR:-/home/danfe/.secrets}"
SECRET_FILE="$SECRET_DIR/danfe_prisma_database.env"
DB_ROLE='danfe_prisma'

if [[ ! -r "$ENV_FILE" ]] || [[ ! -r "$ROLE_SQL" ]]; then
  echo 'Arquivos necessarios para configurar a role Prisma nao foram encontrados.' >&2
  exit 1
fi

tenant="$(grep '^POOLER_TENANT_ID=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
if [[ ! "$tenant" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo 'POOLER_TENANT_ID ausente ou invalido.' >&2
  exit 1
fi

install -d -m 700 -o danfe -g danfe "$SECRET_DIR"
if [[ -r "$SECRET_FILE" ]]; then
  password="$(grep '^DANFE_PRISMA_PASSWORD=' "$SECRET_FILE" | head -n 1 | cut -d= -f2-)"
else
  password="$(openssl rand -hex 32)"
fi

if [[ ! "$password" =~ ^[A-Fa-f0-9]{64}$ ]]; then
  echo 'O segredo existente da role Prisma esta invalido.' >&2
  exit 1
fi

docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$ROLE_SQL" >/dev/null
printf "ALTER ROLE %s PASSWORD '%s';\n" "$DB_ROLE" "$password" |
  docker exec -i supabase-db psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null

umask 077
cat > "$SECRET_FILE" <<EOF
DANFE_PRISMA_USER=$DB_ROLE
DANFE_PRISMA_PASSWORD=$password
DANFE_DATABASE_URL=postgresql://${DB_ROLE}.${tenant}:${password}@db.newgrup.cloud:6543/postgres?schema=danfe&sslmode=require&sslaccept=strict&pgbouncer=true&connection_limit=1
EOF
chown danfe:danfe "$SECRET_FILE"
chmod 600 "$SECRET_FILE"

echo 'DANFE_PRISMA_ROLE_CONFIGURED=yes'
echo "DANFE_PRISMA_SECRET_FILE=$SECRET_FILE"
