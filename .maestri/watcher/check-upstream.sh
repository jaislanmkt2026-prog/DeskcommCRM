#!/usr/bin/env bash
# Crivo Watcher — upstream monitor for DeskcommCRM
# Owner: CRIVO | Frequency: 6h | Auto-merge: NO | Auto-push: NO
# Pure bash — no jq dependency (Windows Git Bash compatible)
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
STATE_FILE="$REPO_DIR/.maestri/watcher/upstream-state.json"
UPSTREAM="upstream"
BRANCH="main"

cd "$REPO_DIR"

# --- Pure-bash JSON helpers (no jq) ---
json_get() {
  local key="$1" file="$2"
  grep -oP "\"$key\"\s*:\s*\"[^\"]*\"" "$file" | head -1 | sed 's/.*:\s*"//;s/"$//'
}
json_get_bool() {
  local key="$1" file="$2"
  grep -oP "\"$key\"\s*:\s*(true|false)" "$file" | head -1 | sed 's/.*:\s*//'
}
json_set() {
  local key="$1" val="$2" file="$3"
  if grep -qP "\"$key\"\s*:" "$file"; then
    sed -i "s|\"$key\"\s*:\s*\"[^\"]*\"|\"$key\": \"$val\"|" "$file"
    sed -i "s|\"$key\"\s*:\s*\(true\|false\)|\"$key\": $val|" "$file"
  fi
}

# Read last seen state
LAST_HEAD=$(json_get "last_seen_head" "$STATE_FILE")
LAST_TAG=$(json_get "last_seen_tag" "$STATE_FILE")
LAST_RELEASE=$(json_get "last_seen_release" "$STATE_FILE")

# Fetch latest upstream refs (no merge, no working tree change)
git fetch "$UPSTREAM" "$BRANCH" --quiet 2>/dev/null || { echo "ERROR: cannot fetch upstream"; exit 1; }

CURRENT_HEAD=$(git rev-parse "$UPSTREAM/$BRANCH")
LATEST_TAG=$(git ls-remote --tags "$UPSTREAM" 2>/dev/null | grep -oP 'refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 | sed 's|refs/tags/||')
LATEST_RELEASE=$(curl -sf "https://api.github.com/repos/melgarafael/DeskcommCRM/releases?per_page=1" 2>/dev/null | grep -oP '"tag_name"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"tag_name"\s*:\s*"//;s/"$//')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

UPDATE_FOUND=false
NEW_COMMITS=""
NEW_TAGS=""
NEW_RELEASES=""
RISK="BAIXO"
CONFLICTS=""

# Compare HEAD
if [ "$CURRENT_HEAD" != "$LAST_HEAD" ]; then
  UPDATE_FOUND=true
  NEW_COMMITS=$(git log --oneline "$LAST_HEAD..$UPSTREAM/$BRANCH" 2>/dev/null | head -50)

  # Classify risk by changed files
  CHANGED_FILES=$(git diff --name-only "$LAST_HEAD..$UPSTREAM/$BRANCH" 2>/dev/null)
  HIGH_RISK_PATTERNS="migration|supabase|rls|auth|lia|agent-engine|multi-tenant|imobiliario|time-chaves|squad100|baseline\.sql"
  MEDIUM_RISK_PATTERNS="api/|components/|workers/|integrations/"

  if echo "$CHANGED_FILES" | grep -qiE "$HIGH_RISK_PATTERNS"; then
    RISK="ALTO"
    CONFLICTS=$(echo "$CHANGED_FILES" | grep -iE "$HIGH_RISK_PATTERNS" | head -20)
  elif echo "$CHANGED_FILES" | grep -qiE "$MEDIUM_RISK_PATTERNS"; then
    RISK="MÉDIO"
  fi
fi

# Compare tags
if [ -n "$LATEST_TAG" ] && [ "$LATEST_TAG" != "$LAST_TAG" ]; then
  UPDATE_FOUND=true
  NEW_TAGS="$LATEST_TAG (anterior: $LAST_TAG)"
fi

# Compare releases
if [ -n "$LATEST_RELEASE" ] && [ "$LATEST_RELEASE" != "$LAST_RELEASE" ]; then
  UPDATE_FOUND=true
  NEW_RELEASES="$LATEST_RELEASE (anterior: $LAST_RELEASE)"
fi

# Update state file (pure bash JSON update)
ORIGIN_HEAD=$(git ls-remote origin "$BRANCH" 2>/dev/null | awk '{print $1}')
LOCAL_HEAD=$(git rev-parse HEAD)

json_set "last_seen_head" "$CURRENT_HEAD" "$STATE_FILE"
json_set "last_seen_tag" "${LATEST_TAG:-$LAST_TAG}" "$STATE_FILE"
json_set "last_seen_release" "${LATEST_RELEASE:-$LAST_RELEASE}" "$STATE_FILE"
json_set "origin_head" "$ORIGIN_HEAD" "$STATE_FILE"
json_set "local_head" "$LOCAL_HEAD" "$STATE_FILE"
json_set "checked_at" "$TIMESTAMP" "$STATE_FILE"
json_set "update_found" "$UPDATE_FOUND" "$STATE_FILE"

# Output report
if [ "$UPDATE_FOUND" = true ]; then
  echo "# ATUALIZAÇÃO UPSTREAM DETECTADA"
  echo "## Rafael / upstream"
  echo "HEAD anterior: $LAST_HEAD"
  echo "HEAD novo: $CURRENT_HEAD"
  echo ""
  echo "## Commits novos"
  echo "$NEW_COMMITS" | head -20
  echo ""
  echo "## Tags/releases"
  [ -n "$NEW_TAGS" ] && echo "Tags: $NEW_TAGS"
  [ -n "$NEW_RELEASES" ] && echo "Releases: $NEW_RELEASES"
  echo ""
  echo "## Risco: $RISK"
  [ -n "$CONFLICTS" ] && echo "## Possíveis conflitos com CRM JS Imóveis:" && echo "$CONFLICTS"
  echo ""
  echo "## Ação: AGUARDANDO MISSÃO DO CODEX"
else
  echo "UPSTREAM_CHECK=OK"
  echo "UPDATE_FOUND=NO"
  echo "HEAD=$CURRENT_HEAD"
  echo "CHECKED_AT=$TIMESTAMP"
fi