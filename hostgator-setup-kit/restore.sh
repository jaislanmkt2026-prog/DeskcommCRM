#!/usr/bin/env bash
# Restaura o banco a partir de um dump gerado pelo backup.sh.
# CUIDADO: sobrescreve o schema/dados atuais do banco.
#
#   bash hostgator-setup-kit/restore.sh backups/db-20260702-030000.sql.gz
source "$(dirname "$0")/_common.sh"
enter_project

ASSUME_YES=""
DB_ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) ASSUME_YES=1 ; shift ;;
    --db-only) DB_ONLY=1 ; shift ;;
    *) break ;;
  esac
done
DUMP="${1:-}"
[ -n "$DUMP" ] && [ -f "$DUMP" ] || die "Uso: restore.sh [--yes] [--db-only] <arquivo-db-*.sql.gz>"
[ $# -eq 1 ] || die "Uso: restore.sh [--yes] [--db-only] <arquivo-db-*.sql.gz>"
gzip -t "$DUMP" 2>/dev/null || die "O dump informado está corrompido ou não é um gzip válido. Nada foi restaurado."

c_ylw "⚠ Isto vai SOBRESCREVER o banco em $NEXT_PUBLIC_SUPABASE_URL."
if [ -z "$ASSUME_YES" ]; then
  read -r -p "Digite 'RESTAURAR' para confirmar: " a
  [ "$a" = "RESTAURAR" ] || die "Cancelado."
fi

step "Restaurando $DUMP"
# `pg_dump --clean` remove/recria o que EXISTIA no backup, mas não conhece
# objetos criados depois dele. Antes de reaplicar o dump, limpamos os objetos
# de aplicação do schema public sem apagar o schema em si (preserva owner/ACL)
# e o schema privado que pertence ao DeskcommCRM. Objetos de extensões são
# deixados em paz: o Supabase também usa extensões e elas não devem ser
# desmontadas por um rollback de aplicação.
#
# Cleanup + dump rodam na MESMA transação. Se qualquer DROP ou qualquer linha
# do dump falhar, o PostgreSQL desfaz a restauração inteira.
limpar_objetos_da_aplicacao() {
  cat <<'SQL'
DO $deskcomm_restore$
DECLARE
  r record;
  kind text;
BEGIN
  FOR r IN
    SELECT c.relkind, format('%I.%I', n.nspname, c.relname) AS ident
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r','p','v','m','S','f','c')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_class'::regclass
            AND d.objid = c.oid
            AND d.deptype = 'e'
       )
  LOOP
    kind := CASE r.relkind
      WHEN 'v' THEN 'VIEW'
      WHEN 'm' THEN 'MATERIALIZED VIEW'
      WHEN 'S' THEN 'SEQUENCE'
      WHEN 'f' THEN 'FOREIGN TABLE'
      WHEN 'c' THEN 'TYPE'
      ELSE 'TABLE'
    END;
    EXECUTE format('DROP %s IF EXISTS %s CASCADE', kind, r.ident);
  END LOOP;

  FOR r IN
    SELECT p.prokind,
           format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid)) AS ident
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_proc'::regclass
            AND d.objid = p.oid
            AND d.deptype = 'e'
       )
  LOOP
    kind := CASE r.prokind
      WHEN 'p' THEN 'PROCEDURE'
      WHEN 'a' THEN 'AGGREGATE'
      ELSE 'FUNCTION'
    END;
    EXECUTE format('DROP %s IF EXISTS %s CASCADE', kind, r.ident);
  END LOOP;

  FOR r IN
    SELECT format('%I.%I', n.nspname, t.typname) AS ident
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public'
       AND t.typtype IN ('d','e','r','m')
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
          WHERE d.classid = 'pg_type'::regclass
            AND d.objid = t.oid
            AND d.deptype = 'e'
       )
  LOOP
    EXECUTE format('DROP TYPE IF EXISTS %s CASCADE', r.ident);
  END LOOP;
END
$deskcomm_restore$;

DROP SCHEMA IF EXISTS private CASCADE;
SQL
}

# O update.sh pode instalar estas quatro extensões. Se uma delas não existia
# antes da rodada, removê-la faz parte do rollback do banco; extensões que já
# existiam ficam intactas. Fora do rollback supervisionado a variável não vem
# definida e o restore mantém o comportamento compatível com backups antigos.
remover_extensoes_adicionadas() {
  [ "${DESKCOMM_PRE_UPDATE_EXTENSIONS+x}" = x ] || return 0
  local ext
  for ext in vector citext pg_trgm pgcrypto; do
    if ! printf '%s\n' "$DESKCOMM_PRE_UPDATE_EXTENSIONS" | grep -qxF "$ext"; then
      printf 'DROP EXTENSION IF EXISTS "%s" CASCADE;\n' "$ext"
    fi
  done
}

{ limpar_objetos_da_aplicacao; remover_extensoes_adicionadas; gunzip -c "$DUMP"; } \
  | pg_container -i postgres:17-alpine psql -1 -v ON_ERROR_STOP=1 "$(url_do_schema)" \
  && c_grn "✓ banco restaurado" || die "Falha na restauração — veja o log acima."

if [ -z "$DB_ONLY" ]; then
  # Restaura o estado das sessões do WhatsApp (WAHA) se o snapshot emparelhado existir
  WAHA_TAR="${DUMP/db-/waha-}"
  WAHA_TAR="${WAHA_TAR%.sql.gz}.tgz"
  if [ -f "$WAHA_TAR" ]; then
    step "Restaurando sessões do WhatsApp de $WAHA_TAR"
    vol="$(volume_waha_data)"
    WAHA_DIR="$(cd "$(dirname "$WAHA_TAR")" && pwd)"
    WAHA_FILE="$(basename "$WAHA_TAR")"
    docker run --rm -v "${vol}:/data" -v "${WAHA_DIR}:/in:ro" alpine:3.20 \
      sh -c "rm -rf /data/* && tar xzf /in/${WAHA_FILE} -C /data" \
      && c_grn "✓ sessões do WhatsApp restauradas" || c_ylw "⚠ Falha ao restaurar sessões do WhatsApp"
  fi

  # Single-server: os anexos voltam junto com o banco (ver backup.sh).
  if [ "${SINGLE_SERVER:-0}" = "1" ]; then
    STORAGE_TAR="$(dirname "$DUMP")/storage-$(basename "$DUMP" .sql.gz | sed 's/^db-//').tgz"
    if [ -f "$STORAGE_TAR" ]; then
      step "Restaurando os arquivos anexados de $STORAGE_TAR"
      docker run --rm -v "$(dir_do_supabase)/volumes/storage:/data" \
        -v "$(cd "$(dirname "$STORAGE_TAR")" && pwd):/in:ro" alpine:3.20 \
        sh -c "find /data -mindepth 1 -delete && tar xzf /in/$(basename "$STORAGE_TAR") -C /data" \
        && c_grn "✓ anexos restaurados" \
        || die "Falha ao restaurar os anexos. O banco JÁ foi restaurado: repita o restore."
    else
      c_ylw "⚠ Não achei $(basename "$STORAGE_TAR") ao lado do dump: o banco voltou, os ANEXOS não."
    fi
  fi
fi

c_ylw "Reinicie o app: docker compose $(dc_files) restart app"
