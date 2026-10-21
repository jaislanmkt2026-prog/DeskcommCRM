#!/usr/bin/env bash
# Prova do cadeado REAL usado por agent.sh/update.sh. Não há dublê de flock.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
UPDATE="$ROOT/hostgator-setup-kit/update.sh"
AGENT="$ROOT/hostgator-setup-kit/agent.sh"
COMMON="$ROOT/hostgator-setup-kit/_common.sh"

command -v flock >/dev/null 2>&1 || {
  echo "BLOQUEADO: flock real não está disponível neste ambiente." >&2
  exit 2
}

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
LOCK="$WORK/.update.lock"

# O agent segura FD 9; o bash filho herda a MESMA descrição de arquivo e deve
# conseguir validar o lock sem se bloquear contra o próprio pai.
exec 9>"$LOCK"
flock -n 9
DESKCOMM_UPDATE_LOCK_FD=9 bash -c 'flock -n "$DESKCOMM_UPDATE_LOCK_FD"'

# Outra abertura do mesmo arquivo é concorrente de verdade e deve ser recusada.
if bash -c 'exec 8>"$1"; flock -n 8' _ "$LOCK"; then
  echo "FALHOU: uma segunda atualização adquiriu o lock enquanto FD 9 estava ativo." >&2
  exit 1
fi

# Depois de liberar o dono, uma nova execução consegue entrar.
exec 9>&-
bash -c 'exec 8>"$1"; flock -n 8' _ "$LOCK"

grep -q 'DESKCOMM_UPDATE_LOCK_FD=9' "$AGENT"
grep -q 'exec 9>"${PROJECT_DIR}/.update.lock"' "$UPDATE"
grep -q 'flock -n 9' "$UPDATE"
grep -q 'DESKCOMM_UPDATE_LOCK_FD:-.*9' "$COMMON"

echo "OK — lock real serializa execução manual e reutiliza FD 9 do agent sem deadlock."
