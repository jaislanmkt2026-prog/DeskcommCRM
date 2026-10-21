#!/usr/bin/env bash
# Prova REAL e destrutiva apenas nos bancos descartáveis da Missão 7.4-R.
# Requer PostgreSQL local (socket), sem Docker e sem URL externa.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_DB="deskcomm_74r_source"
RESTORE_DB="deskcomm_74r_restore"

# Esta prova é propositalmente local. Limpa qualquer configuração PostgreSQL
# herdada que pudesse apontar para outro host e usa o role administrativo do
# PostgreSQL descartável do WSL.
unset PGHOST PGPORT PGDATABASE PGSERVICE PGSERVICEFILE PGPASSFILE PGPASSWORD
export PGUSER="${DESKCOMM_74R_PGUSER:-postgres}"

for cmd in psql pg_dump gzip gunzip; do
  command -v "$cmd" >/dev/null 2>&1 || {
    echo "BLOQUEADO: $cmd não está disponível neste ambiente." >&2
    exit 2
  }
done

PSQL_BIN="$(command -v psql)"
PG_DUMP_BIN="$(command -v pg_dump)"
if [ "$(id -u)" -eq 0 ] && id postgres >/dev/null 2>&1 && command -v runuser >/dev/null 2>&1; then
  psql() { runuser -u postgres -- "$PSQL_BIN" "$@"; }
  pg_dump() { runuser -u postgres -- "$PG_DUMP_BIN" "$@"; }
fi

# Guarda de raio de ação: nomes fixos + conexão por nome usam exclusivamente o
# socket local do PostgreSQL. Nenhuma DATABASE_URL/credencial do CRM é lida.
for db in "$SOURCE_DB" "$RESTORE_DB"; do
  case "$db" in deskcomm_74r_*) : ;; *) echo "recuso banco fora do sandbox 7.4-R: $db" >&2; exit 2;; esac
  atual="$(psql -X -d "$db" -Atqc 'select current_database()')"
  [ "$atual" = "$db" ] || { echo "não conectei ao banco descartável esperado: $db" >&2; exit 2; }
done

grep -q -- '--clean --if-exists' "$ROOT/hostgator-setup-kit/backup.sh"
grep -q 'psql -1 -v ON_ERROR_STOP=1' "$ROOT/hostgator-setup-kit/restore.sh"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
DUMP="$WORK/round.sql.gz"

reset_public() {
  psql -X -v ON_ERROR_STOP=1 -d "$1" <<'SQL' >/dev/null
drop schema if exists public cascade;
drop schema if exists storage cascade;
drop schema if exists auth cascade;
create schema public;
SQL
}

reset_public "$SOURCE_DB"
psql -X -v ON_ERROR_STOP=1 -d "$SOURCE_DB" <<'SQL' >/dev/null
create schema if not exists auth;
create schema if not exists storage;
create table if not exists auth.users (id integer primary key, nome text not null);
create table if not exists storage.objects (id integer primary key, owner_id integer references auth.users(id));
insert into auth.users values (1, 'infra-antes');
insert into storage.objects values (1, 1);

create table public.rollback_probe (
  id integer primary key,
  estado text not null
);
create function public.rollback_estado() returns text language sql stable
as $$ select estado from public.rollback_probe where id = 1 $$;
insert into public.rollback_probe values (1, 'antes');
SQL

pg_dump "$SOURCE_DB" --no-owner --no-privileges --clean --if-exists | gzip > "$DUMP"
gzip -t "$DUMP"

reset_public "$RESTORE_DB"
gunzip -c "$DUMP" | psql -X -v ON_ERROR_STOP=1 -d "$RESTORE_DB" >/dev/null

# Simula uma atualização que alterou dados e schema depois do backup.
psql -X -v ON_ERROR_STOP=1 -d "$RESTORE_DB" <<'SQL' >/dev/null
update public.rollback_probe set estado = 'depois' where id = 1;
alter table public.rollback_probe add column coluna_da_migracao text default 'nova';
create table public.tabela_da_migracao (id integer primary key);
create function public.funcao_da_migracao() returns integer language sql immutable as $$ select 74 $$;
create extension if not exists pgcrypto;
update auth.users set nome = 'infra-depois' where id = 1;
SQL

# Reproduz exatamente o miolo transacional do restore.sh, sem Docker nem .env.
cleanup="$(sed -n '/^limpar_objetos_da_aplicacao() {$/,/^}$/p' "$ROOT/hostgator-setup-kit/restore.sh")"
extensions_cleanup="$(sed -n '/^remover_extensoes_adicionadas() {$/,/^}$/p' "$ROOT/hostgator-setup-kit/restore.sh")"
eval "$cleanup"
eval "$extensions_cleanup"
DESKCOMM_PRE_UPDATE_EXTENSIONS=""
export DESKCOMM_PRE_UPDATE_EXTENSIONS
{ limpar_objetos_da_aplicacao; remover_extensoes_adicionadas; gunzip -c "$DUMP"; } | psql -X -1 -v ON_ERROR_STOP=1 -d "$RESTORE_DB" >/dev/null

[ "$(psql -X -d "$RESTORE_DB" -Atqc "select estado from public.rollback_probe where id=1")" = antes ]
[ "$(psql -X -d "$RESTORE_DB" -Atqc "select count(*) from information_schema.columns where table_schema='public' and table_name='rollback_probe' and column_name='coluna_da_migracao'")" = 0 ]
[ "$(psql -X -d "$RESTORE_DB" -Atqc "select count(*) from information_schema.tables where table_schema='public' and table_name='tabela_da_migracao'")" = 0 ]
[ "$(psql -X -d "$RESTORE_DB" -Atqc "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='funcao_da_migracao'")" = 0 ]
[ "$(psql -X -d "$RESTORE_DB" -Atqc "select public.rollback_estado()")" = antes ]
[ "$(psql -X -d "$RESTORE_DB" -Atqc "select count(*) from pg_extension where extname='pgcrypto'")" = 0 ]
[ "$(psql -X -d "$RESTORE_DB" -Atqc "select nome from auth.users where id=1")" = infra-antes ]
[ "$(psql -X -d "$RESTORE_DB" -Atqc "select count(*) from storage.objects where id=1")" = 1 ]

echo "OK — dump -> mutação -> restore devolveu public + dados e preservou schemas de infraestrutura."
