#!/usr/bin/env bash
# Crivo Update Script — aplica atualização física após dispatch
set -euo pipefail

FROM_VERSION="${1:-}"
TO_VERSION="${2:-}"
ENVIRONMENT="${3:-local}"

echo "[CrivoUpdate] Iniciando update: ${FROM_VERSION} → ${TO_VERSION} (env: ${ENVIRONMENT})"

# 1. Backup prévio do banco
BACKUP_DIR="C:/Jaislan/Backups"
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
docker exec supa-db pg_dump -U postgres -d postgres > "${BACKUP_DIR}/pre_crivo_${TIMESTAMP}.sql"
echo "[CrivoUpdate] Backup salvo: pre_crivo_${TIMESTAMP}.sql"

# 2. Git pull seguro (não destrutivo)
cd /c/Jaislan/Projects/DeskcommCRM
git fetch origin main
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main)

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
  echo "[CrivoUpdate] Já atualizado (${LOCAL_COMMIT})."
else
  echo "[CrivoUpdate] Aplicando update: ${LOCAL_COMMIT} → ${REMOTE_COMMIT}"
  git merge --ff-only origin/main
fi

# 3. Aplicar migrações Supabase pendentes
docker exec supa-db psql -U postgres -d postgres -f /app/supabase/migrations/*.sql || true

# 4. Restart dos containers para carregar novo código
docker compose restart app worker

# 5. Aguardar health-check
sleep 10
curl -f http://localhost:3000/api/health || exit 1

echo "[CrivoUpdate] Update concluído com sucesso."