#!/usr/bin/env bash
set -euo pipefail

# Enables native TLS on the existing Supavisor transaction pooler. It keeps
# port 5432 bound to localhost and leaves only TLS-required 6543 public.

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
ENV_FILE="$SUPABASE_DIR/.env"
COMPOSE_FILE="$SUPABASE_DIR/docker-compose.yml"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TLS_PATCHER="$SCRIPT_DIR/configurar-supavisor-tls.py"
REFRESH_SCRIPT="$SCRIPT_DIR/atualizar-certificado-supavisor-vps.sh"

for file in "$ENV_FILE" "$COMPOSE_FILE" "$TLS_PATCHER" "$REFRESH_SCRIPT"; do
  if [[ ! -r "$file" ]]; then
    echo "Arquivo necessario nao encontrado: $file" >&2
    exit 1
  fi
done

tenant="$(grep '^POOLER_TENANT_ID=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)"
if [[ ! "$tenant" =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo 'POOLER_TENANT_ID ausente ou invalido.' >&2
  exit 1
fi

stamp="$(date +%Y%m%d%H%M%S)"
cp -p "$COMPOSE_FILE" "$COMPOSE_FILE.before-supavisor-tls-$stamp"
python3 "$TLS_PATCHER" "$COMPOSE_FILE"

install -m 700 -o root -g root "$REFRESH_SCRIPT" /usr/local/sbin/atualizar-certificado-supavisor
RESTART_SUPAVISOR=0 /usr/local/sbin/atualizar-certificado-supavisor

printf "UPDATE _supavisor.tenants SET enforce_ssl = true WHERE external_id = '%s' RETURNING external_id, enforce_ssl;\n" "$tenant" |
  docker exec -i supabase-db psql -U supabase_admin -d _supabase -v ON_ERROR_STOP=1

cd "$SUPABASE_DIR"
docker compose up -d --force-recreate --no-deps supavisor >/dev/null

pooler_ready=false
for _ in {1..45}; do
  if [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' supabase-pooler 2>/dev/null || true)" == 'healthy' ]]; then
    pooler_ready=true
    break
  fi
  sleep 1
done

if [[ "$pooler_ready" != true ]]; then
  echo 'Supavisor nao ficou saudavel apos habilitar TLS.' >&2
  docker logs --tail 80 supabase-pooler >&2 || true
  exit 1
fi

cat > /etc/cron.d/supavisor-tls-refresh <<'EOF'
# Renova a copia TLS do Supavisor depois de renovacoes do CloudPanel/Let's Encrypt.
17 4 * * * root /usr/local/sbin/atualizar-certificado-supavisor >> /var/log/supavisor-tls-refresh.log 2>&1
EOF
chmod 644 /etc/cron.d/supavisor-tls-refresh

echo 'SUPAVISOR_TLS_CONFIGURED=yes'
echo 'POSTGRES_5432_BIND=localhost'
echo 'POOLER_6543_TLS_REQUIRED=yes'
