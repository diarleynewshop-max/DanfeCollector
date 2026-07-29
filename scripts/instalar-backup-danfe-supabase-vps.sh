#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$SCRIPT_DIR/backup-danfe-supabase-vps.sh"
TARGET='/usr/local/sbin/backup-danfe-supabase'

if [[ ! -r "$SOURCE" ]]; then
  echo "Script de backup nao encontrado: $SOURCE" >&2
  exit 1
fi

install -m 700 -o root -g root "$SOURCE" "$TARGET"
cat > /etc/cron.d/danfe-supabase-backup <<'EOF'
# Backup semanal do schema/Storage Danfe no Supabase local.
5 3 * * 0 root /usr/local/sbin/backup-danfe-supabase >> /home/danfe/backups/backup-supabase.log 2>&1
EOF
chmod 644 /etc/cron.d/danfe-supabase-backup

echo "DANFE_SUPABASE_BACKUP_SCRIPT=$TARGET"
echo 'DANFE_SUPABASE_BACKUP_SCHEDULE=domingo-03:05'
