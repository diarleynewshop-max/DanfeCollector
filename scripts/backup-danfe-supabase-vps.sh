#!/usr/bin/env bash
set -euo pipefail
umask 077

# Root-only backup for the migrated Danfe data. It keeps the schema dump, the
# two private Storage buckets and the legacy files/certificates needed by the
# fiscal worker during the transition to Vercel.

APP_DIR="${DANFE_APP_DIR:-/home/danfe/htdocs/danfe.newgrup.cloud}"
SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
BACKUP_DIR="${DANFE_BACKUP_DIR:-/home/danfe/backups}"
STORAGE_ROOT="$SUPABASE_DIR/volumes/storage/stub/stub"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK_DIR="$(mktemp -d /tmp/danfe-supabase-backup.XXXXXX)"
OUT="$BACKUP_DIR/danfe-supabase-$STAMP.tgz"

cleanup() {
  rm -rf -- "$WORK_DIR"
}
trap cleanup EXIT

for directory in "$APP_DIR" "$SUPABASE_DIR" "$STORAGE_ROOT/danfe-xml" "$STORAGE_ROOT/danfe-anexos"; do
  if [[ ! -d "$directory" ]]; then
    echo "Diretorio necessario nao encontrado: $directory" >&2
    exit 1
  fi
done

install -d -m 700 -o danfe -g danfe "$BACKUP_DIR"
docker exec supabase-db pg_dump -U postgres -d postgres --format=custom --schema=danfe > "$WORK_DIR/danfe-supabase.pg.dump"

app_items=(.env certs downloads anexos prisma/schema.prisma)
for item in "${app_items[@]}"; do
  if [[ ! -e "$APP_DIR/$item" ]]; then
    echo "Item nao encontrado no app e sera ignorado: $item" >&2
  fi
done

tar_args=(
  -C "$WORK_DIR" danfe-supabase.pg.dump
  -C "$STORAGE_ROOT" danfe-xml danfe-anexos
)
for item in "${app_items[@]}"; do
  [[ -e "$APP_DIR/$item" ]] && tar_args+=(-C "$APP_DIR" "$item")
done

tar czf "$OUT" "${tar_args[@]}"
chown danfe:danfe "$OUT"
chmod 600 "$OUT"
sha256sum "$OUT" > "$OUT.sha256"
chown danfe:danfe "$OUT.sha256"
chmod 600 "$OUT.sha256"

# Keep the eight newest complete archives and their matching checksums.
mapfile -t old_backups < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'danfe-supabase-*.tgz' -printf '%T@ %p\n' | sort -nr | tail -n +9 | cut -d' ' -f2-)
for backup in "${old_backups[@]}"; do
  rm -f -- "$backup" "$backup.sha256"
done

ln -sfn "$(basename "$OUT")" "$BACKUP_DIR/danfe-supabase-latest.tgz"
echo "DANFE_SUPABASE_BACKUP=$OUT"
