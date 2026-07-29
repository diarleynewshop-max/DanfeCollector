#!/usr/bin/env python3
"""Idempotently enables native PostgreSQL TLS on the existing Supavisor."""

from pathlib import Path
import re
import sys


def replace_once(text: str, needle: str, replacement: str, label: str) -> str:
    if needle not in text:
        raise RuntimeError(f"Nao foi possivel localizar {label} no docker-compose.")
    return text.replace(needle, replacement, 1)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Uso: configurar-supavisor-tls.py <docker-compose.yml>")

    path = Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")
    match = re.search(r"(?ms)^  supavisor:\n.*?(?=^  [A-Za-z0-9_-]+:\n|\Z)", text)
    if not match:
        raise RuntimeError("Servico supavisor nao encontrado no docker-compose.")

    block = match.group(0)
    block = block.replace(
        "      - ${POSTGRES_PORT}:5432\n", "      - 127.0.0.1:${POSTGRES_PORT}:5432\n"
    )
    if "127.0.0.1:${POSTGRES_PORT}:5432" not in block:
        raise RuntimeError("Mapeamento da porta 5432 do Supavisor nao encontrado.")

    tls_volume = "      - ./volumes/pooler/tls:/etc/supavisor/tls:ro\n"
    if "/etc/supavisor/tls" not in block:
        block = replace_once(
            block,
            "      - ./volumes/pooler/pooler.exs:/etc/pooler/pooler.exs:ro,z\n",
            "      - ./volumes/pooler/pooler.exs:/etc/pooler/pooler.exs:ro,z\n" + tls_volume,
            "volume pooler.exs",
        )

    if "GLOBAL_DOWNSTREAM_CERT_PATH:" not in block:
        env_anchor = "      API_JWT_SECRET: ${JWT_SECRET}\n"
        tls_env = (
            "      GLOBAL_DOWNSTREAM_CERT_PATH: /etc/supavisor/tls/db.newgrup.cloud.crt\n"
            "      GLOBAL_DOWNSTREAM_KEY_PATH: /etc/supavisor/tls/db.newgrup.cloud.key\n"
        )
        block = replace_once(block, env_anchor, env_anchor + tls_env, "API_JWT_SECRET")

    path.write_text(text[: match.start()] + block + text[match.end() :], encoding="utf-8")


if __name__ == "__main__":
    main()
