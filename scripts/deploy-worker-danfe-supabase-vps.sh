#!/usr/bin/env bash
set -euo pipefail

# Deploys a code-only archive to the existing VPS worker. The archive must not
# contain .env, certificates, downloads or anexos; those remain on the VPS.

ARCHIVE="${1:-/tmp/danfe-vps-supabase.tgz}"
APP_DIR="${DANFE_APP_DIR:-/home/danfe/htdocs/danfe.newgrup.cloud}"
BACKUP_DIR="${DANFE_BACKUP_DIR:-/home/danfe/backups}"
NODE_BIN='/home/danfe/.nvm/versions/node/v22.23.1/bin'
STAMP="$(date +%Y%m%d-%H%M%S)"

if [[ ! -r "$ARCHIVE" ]] || [[ ! -d "$APP_DIR" ]]; then
  echo 'Archive de deploy ou pasta do app nao encontrada.' >&2
  exit 1
fi

if tar tzf "$ARCHIVE" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo 'Archive recusado: contem caminho absoluto ou traversal.' >&2
  exit 1
fi

install -d -m 700 -o danfe -g danfe "$BACKUP_DIR"
code_backup="$BACKUP_DIR/danfe-app-before-supabase-$STAMP.tgz"
tar czf "$code_backup" \
  --exclude=./node_modules --exclude=./.next --exclude=./.next-dev --exclude=./.git \
  --exclude=./downloads --exclude=./anexos --exclude=./certs \
  -C "$APP_DIR" .
chown danfe:danfe "$code_backup"
chmod 600 "$code_backup"

tar xzf "$ARCHIVE" -C "$APP_DIR"
chown -R danfe:danfe "$APP_DIR"
chmod 600 "$APP_DIR/.env"
find "$APP_DIR/certs" -type f -name '*.pfx' -exec chmod 600 {} +

chmod 700 "$APP_DIR/scripts/configurar-worker-danfe-supabase-vps.sh"
"$APP_DIR/scripts/configurar-worker-danfe-supabase-vps.sh"

su - danfe -c "export PATH=$NODE_BIN:\$PATH; cd '$APP_DIR' && npm install && npx prisma generate && npm run build"
su - danfe -c "export PATH=$NODE_BIN:\$PATH; pm2 restart danfecollector --update-env; pm2 start '$APP_DIR/ecosystem.config.cjs' --only danfecollector-sync-nf; pm2 save"

http_status="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/login)"
echo "DANFE_WORKER_CODE_BACKUP=$code_backup"
echo "DANFE_LOCAL_HTTP=$http_status"
