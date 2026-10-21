#!/usr/bin/env bash
# Restaura o banco a partir de um dump gerado pelo backup.sh.
# Só restaura num banco VAZIO: num banco que já tem as tabelas do sistema ele
# para antes, sem alterar nada (#2120) — ver a checagem abaixo.
#
# ⚠ O dump do backup.sh sai SEM --clean: não traz DROP/TRUNCATE nem IF NOT
# EXISTS, e ele traz os schemas internos (auth, storage, realtime, vault) e
# extensões como pg_net — então "already exists" e "extension is not
# available" aparecem também num banco VAZIO. Por isso a checagem abaixo é a
# que decide: se public já tem tabelas, paramos ANTES do psql com mensagem
# própria (#2120), em vez de dizer "✓ banco restaurado" sobre ~2.800 erros.
#
# As flags `-v ON_ERROR_STOP=1 --single-transaction` saíram daqui por medição
# do mantenedor em 03/10: elas fazem o restore falhar também em banco vazio
# (rc=3, 0 tabelas) em Supabase novo, Postgres 17 puro e database nova — o
# caminho que hoje funciona deixaria de funcionar. Sem elas, o psql avisa e
# segue, saindo 0 num banco que restaurou.
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
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/backups}"
[ -d "$BACKUP_DIR" ] || die "Diretório de backups não encontrado. Nada foi restaurado."
DUMP_REAL="$(readlink -f -- "$DUMP")"
BACKUP_REAL="$(readlink -f -- "$BACKUP_DIR")"
case "$DUMP_REAL" in
  "$BACKUP_REAL"/db-*.sql.gz) ;;
  *) die "O dump informado está fora do diretório de backups permitido. Nada foi restaurado." ;;
esac
DUMP="$DUMP_REAL"
gzip -t "$DUMP" 2>/dev/null || die "O dump informado está corrompido ou não é um gzip válido. Nada foi restaurado."

c_ylw "⚠ Isto vai restaurar o backup no banco em $NEXT_PUBLIC_SUPABASE_URL (só se ele estiver vazio)."
c_ylw "⚠ O dump do backup.sh sai SEM --clean: ele não restaura por cima de um banco que já tem o schema."
c_ylw "   Ele também traz auth, storage e extensões — os erros de \"already exists\" aparecem até em banco novo."

# #2120: checagem ANTES de pedir a confirmação. Se o banco já tem o schema,
# não adianta chamar o psql (o dump não tem --clean, então ele só gritaria),
# então paramos aqui com a mensagem certa. A contagem é medida em public — é
# onde o dump do backup.sh despeja as tabelas do produto. Os "already exists"
# de auth/storage e a extensão pg_net não entram nessa conta: são internas e
# existem até em banco recém-criado.
# A contagem NÃO pode comer o stdin: o `restore.sh` pede a confirmação logo
# abaixo, e quem chama alimenta tudo com printf 'RESTAURAR\n' | restore.sh.
if tabela="$(pg_container -i postgres:17-alpine psql "$(url_do_schema)" \
      -tAc "select count(*) from pg_tables where schemaname='public'" \
      </dev/null 2>/dev/null)"; then
  # Falhar fechado também quando a conexão "deu certo" e a resposta não é um
  # número (vazio, aviso no stdout): sem saber a contagem, não restauramos.
  case "$tabela" in ''|*[!0-9]*)
    die "Não consegui conferir se o banco em $NEXT_PUBLIC_SUPABASE_URL está vazio (a contagem voltou [$tabela]): nada foi alterado." ;;
  esac
  if [ "$tabela" -gt 0 ]; then
    die "O banco em $NEXT_PUBLIC_SUPABASE_URL já tem as tabelas do sistema ($tabela em public): nada foi alterado. Este backup só volta num banco vazio — por exemplo, um projeto Supabase novo em que o instalador ainda não rodou. Veja \"Restaurar um backup\" em hostgator-setup-kit/README.md, ou peça ajuda."
  fi
else
  die "Não consegui conferir se o banco em $NEXT_PUBLIC_SUPABASE_URL está vazio: nada foi alterado."
fi

read -r -p "Digite 'RESTAURAR' para confirmar: " a
[ "$a" = "RESTAURAR" ] || die "Cancelado."

step "Restaurando $DUMP"
# Sem `-v ON_ERROR_STOP=1 --single-transaction` (medição do mantenedor em
# 03/10): com elas o restore falha também em banco VAZIO — Supabase novo,
# Postgres 17 puro e database nova deram rc=3 e 0 tabelas; sem elas, nos dois
# primeiros, o mesmo dump entrou com rc=0 e 110 tabelas. O dump traz auth, storage e
# extensões que já existem num Supabase novo, então o erro é normal ali. Quem
# segura o banco populado é a checagem de cima; aqui o psql avisa, segue e sai
# 0, e o `&&` só confirma o rc. Em falha fatal (conexão, disco) o banco pode
# ficar incompleto — sem a transação única não há rollback, por isso o aviso
# abaixo não promete mais que nada.
gunzip -c "$DUMP" | pg_container -i postgres:17-alpine psql "$(url_do_schema)" \
  && c_grn "✓ banco restaurado" || die "Falha na restauração — confira o log acima e o estado do banco antes de repetir."

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
