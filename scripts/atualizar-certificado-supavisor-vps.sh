#!/usr/bin/env bash
set -euo pipefail

# Copies the current db.newgrup.cloud certificate to the Supavisor mount and
# recreates only the pooler when the certificate has changed.

SUPABASE_DIR="${SUPABASE_DIR:-/opt/supabase}"
SOURCE_CERT="${SOURCE_CERT:-/etc/nginx/ssl-certificates/db.newgrup.cloud.crt}"
SOURCE_KEY="${SOURCE_KEY:-/etc/nginx/ssl-certificates/db.newgrup.cloud.key}"
TLS_DIR="$SUPABASE_DIR/volumes/pooler/tls"
TARGET_CERT="$TLS_DIR/db.newgrup.cloud.crt"
TARGET_KEY="$TLS_DIR/db.newgrup.cloud.key"

for source in "$SOURCE_CERT" "$SOURCE_KEY"; do
  if [[ ! -r "$source" ]]; then
    echo "Certificado TLS nao encontrado: $source" >&2
    exit 1
  fi
done

cert_pubkey="$(openssl x509 -in "$SOURCE_CERT" -pubkey -noout | openssl pkey -pubin -pubout | sha256sum | cut -d' ' -f1)"
key_pubkey="$(openssl pkey -in "$SOURCE_KEY" -pubout | sha256sum | cut -d' ' -f1)"
if [[ "$cert_pubkey" != "$key_pubkey" ]]; then
  echo 'O certificado e a chave privada de db.newgrup.cloud nao correspondem.' >&2
  exit 1
fi

# The source key was previously world-readable. Keep the source and the copy
# private; Supavisor reads only the mounted copy.
chmod 600 "$SOURCE_KEY"
chmod 644 "$SOURCE_CERT"
install -d -m 700 -o root -g root "$TLS_DIR"

changed=false
if [[ ! -f "$TARGET_CERT" ]] || ! cmp -s "$SOURCE_CERT" "$TARGET_CERT"; then
  install -m 644 -o root -g root "$SOURCE_CERT" "$TARGET_CERT"
  changed=true
fi
if [[ ! -f "$TARGET_KEY" ]] || ! cmp -s "$SOURCE_KEY" "$TARGET_KEY"; then
  install -m 600 -o root -g root "$SOURCE_KEY" "$TARGET_KEY"
  changed=true
fi

if [[ "$changed" == true ]]; then
  echo 'SUPAVISOR_TLS_CERT_UPDATED=yes'
  if [[ "${RESTART_SUPAVISOR:-1}" == '1' ]]; then
    (
      cd "$SUPABASE_DIR"
      docker compose up -d --force-recreate --no-deps supavisor >/dev/null
    )
    echo 'SUPAVISOR_RESTARTED=yes'
  fi
else
  echo 'SUPAVISOR_TLS_CERT_UPDATED=no'
fi
