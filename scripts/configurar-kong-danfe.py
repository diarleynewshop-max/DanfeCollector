#!/usr/bin/env python3
"""Idempotently adds the isolated Danfe API consumer to Supabase Kong."""

from pathlib import Path
import re
import sys


def replace_once(text: str, needle: str, replacement: str, label: str) -> str:
    if needle not in text:
        raise RuntimeError(f"Nao foi possivel localizar {label} no arquivo Kong.")
    return text.replace(needle, replacement, 1)


def patch_kong(path: Path) -> None:
    text = path.read_text(encoding="utf-8")

    if "username: danfe_api" not in text:
        anchor = """  - username: service_role
    keyauth_credentials:
      - key: $SUPABASE_SERVICE_KEY
      - key: $SUPABASE_SECRET_KEY
"""
        consumer = """  - username: danfe_api
    keyauth_credentials:
      - key: $DANFE_SUPABASE_KEY
"""
        text = replace_once(text, anchor, anchor + consumer, "consumer service_role")

    if "consumer: danfe_api" not in text:
        anchor = """  - consumer: service_role
    group: admin
"""
        acl = """  - consumer: danfe_api
    group: danfe
"""
        text = replace_once(text, anchor, anchor + acl, "ACL service_role")

    rest_start = text.find("  - name: rest-v1\n")
    if rest_start == -1:
        raise RuntimeError("Servico rest-v1 nao encontrado no arquivo Kong.")
    rest_end = text.find("\n  ## ", rest_start)
    if rest_end == -1:
        rest_end = len(text)
    rest_block = text[rest_start:rest_end]

    if "            - danfe" not in rest_block:
        allow = """          allow:
            - admin
            - anon
"""
        allow_with_danfe = """          allow:
            - admin
            - anon
            - danfe
"""
        rest_block = replace_once(rest_block, allow, allow_with_danfe, "ACL do rest-v1")
        text = text[:rest_start] + rest_block + text[rest_end:]

    path.write_text(text, encoding="utf-8")


def patch_compose(path: Path) -> None:
    text = path.read_text(encoding="utf-8")
    kong_match = re.search(
        r"(?ms)^  kong:\n.*?(?=^  [A-Za-z0-9_-]+:\n|\Z)", text
    )
    if not kong_match:
        raise RuntimeError("Servico kong nao encontrado no docker-compose.")

    # Remove a previous erroneous insertion from another service, then add the
    # credential only to Kong (which consumes the declarative config).
    before = text[:kong_match.start()].replace(
        "      DANFE_SUPABASE_KEY: ${DANFE_SUPABASE_KEY}\n", ""
    )
    kong_block = kong_match.group(0)
    after = text[kong_match.end():].replace(
        "      DANFE_SUPABASE_KEY: ${DANFE_SUPABASE_KEY}\n", ""
    )

    if "DANFE_SUPABASE_KEY:" not in kong_block:
        anchor = "      SUPABASE_SERVICE_KEY: ${SERVICE_ROLE_KEY}\n"
        addition = "      DANFE_SUPABASE_KEY: ${DANFE_SUPABASE_KEY}\n"
        kong_block = replace_once(
            kong_block, anchor, anchor + addition, "variavel Kong SUPABASE_SERVICE_KEY"
        )

    text = before + kong_block + after
    path.write_text(text, encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("Uso: configurar-kong-danfe.py <kong.yml> <docker-compose.yml>")
    patch_kong(Path(sys.argv[1]))
    patch_compose(Path(sys.argv[2]))


if __name__ == "__main__":
    main()
