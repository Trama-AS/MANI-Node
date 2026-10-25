#!/usr/bin/env bash
# Prepara una base PostgreSQL vacía para las pruebas de tests/integration/pg, que se omiten sin
# TEST_DATABASE_URL. Aplica, en orden:
#   1. el stub de auth.uid(): Supabase lo provee y Postgres plano no; las funciones de 002/004/005 lo usan;
#   2. las migraciones base 001-008 de MANI-APIGateway/database/migrations (dueño del esquema base);
#   3. las migraciones de Core de este repositorio (db/migrations, ADR-0030).
# Así las pruebas corren contra el mismo esquema que QA. Se usa en CI y en local.
#
# Uso: TEST_DATABASE_URL=postgres://... scripts/preparar-base-pruebas.sh <ruta a MANI-APIGateway/database/migrations>
set -euo pipefail

url="${TEST_DATABASE_URL:?definir TEST_DATABASE_URL}"
dir_gateway="${1:?indicar la ruta a MANI-APIGateway/database/migrations}"
dir_core="$(cd "$(dirname "$0")/.." && pwd)/db/migrations"

ejecutar() { psql "$url" -q -v ON_ERROR_STOP=1 "$@"; }

ejecutar -c 'CREATE SCHEMA IF NOT EXISTS auth;' \
  -c 'CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;'

aplicar_serie() {
  local dir="$1" minimo="$2" n=0
  for f in $(find "$dir" -maxdepth 1 -name '*.sql' | sort); do
    ejecutar -f "$f" > /dev/null
    echo "aplicada $(basename "$f")"
    n=$((n + 1))
  done
  # Una serie vacía o incompleta dejaría las pruebas contra un esquema que no es el de los ambientes.
  if [ "$n" -lt "$minimo" ]; then
    echo "::error::$dir tiene $n migraciones; se esperaban al menos $minimo" >&2
    exit 1
  fi
}

aplicar_serie "$dir_gateway" 8
aplicar_serie "$dir_core" 1
echo "Base de pruebas lista"
