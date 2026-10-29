#!/usr/bin/env bash
# Rebuilds a throwaway local database and runs every check.
set -e
cd "$(dirname "$0")/.."
P="psql -h ${PGHOST:-/tmp} -p ${PGPORT:-5433} -U postgres -v ON_ERROR_STOP=1 -q -t -A"
$P -c "drop database if exists plutus_test" >/dev/null
$P -c "create database plutus_test" >/dev/null
for f in tests/00_supabase_shim.sql migrations/*.sql tests/01_seed_demo.sql tests/02_assertions.sql; do
  $P -d plutus_test -f "$f"
done
