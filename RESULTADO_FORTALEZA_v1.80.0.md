# Plano de Atualização CRM v1.80.0 — FORTALEZA

**Data:** 2026-10-15  
**Worktree:** `C:\Jaislan\Projects\DeskcommCRM-v1.80-merge` (branch `atualizacao/dono-v1.80.0`)  
**Base commit:** `c9cc73f21` (detached HEAD, merge sem commit)  
**Status atual:** Merge limpo, sem conflitos, working tree suja com mudanças da v1.80.0

---

## 1. DUMP BACKUP DO BANCO

### Comando de backup
```bash
pg_dump -h <SUPABASE_HOST> -U postgres -d deskcomm --format=custom --compress=zstd --file=D:\BACKUPSGERAL\DeskcommCRM\backup-pre-v1.80.0-$(date +%Y%m%d-%H%M%S).dump
```

### Verificação pós-backup
```bash
pg_restore --list D:\BACKUPSGERAL\DeskcommCRM\backup-pre-v1.80.0-*.dump | head -20
```

### Localização obrigatória
Todo backup vai **somente** para `D:\BACKUPSGERAL\DeskcommCRM\` (ordem do Jaislan, 12/09/2026). Nunca espalhar por outras pastas.

---

## 2. BASELINE IDEMPOTENTE

### Estado atual
- Arquivo: `supabase/baseline.sql` no worktree de merge
- O baseline é dump `--schema-only` + apêndice idempotente no fim
- Kit self-host aplica **só o baseline**, tanto em `install.sh` quanto em `update.sh`

### Segunda passada no scratch-pg
O trabalho anterior já aplicou o baseline num Postgres descartável (`scratch-pg`). A segunda passada deve validar:

```bash
# Aplicar novamente no mesmo banco (deve ser idempotente)
psql "$SCRATCH_PG_URL" -f supabase/baseline.sql

# Verificar que não há erros de duplicação ou constraint violada
echo $?
```

### Pontos de atenção no apêndice
- Toda mudança de schema pós-snapshot DEVE estar no apêndice como bloco idempotente
- Blocos rotulados: `-- ---- <coisa> (migration NNNN) ----`
- Padrões obrigatórios:
  - `add column if not exists`
  - `create ... if not exists`
  - `create or replace function`
  - Dados deduplicados/corrigidos ANTES de criar constraint nova

### Validação de funções security definer
Toda função nova em `public` deve terminar com:
```sql
revoke execute on function public.fn_x(...) from public, anon;
grant execute on function public.fn_x(...) to <só quem precisa>;
```

Vigiado por `tests/invariants/hardening-definer-varredura.test.ts`.

---

## 3. BUILD DAS 3 IMAGENS DO WORKTREE MERGE

As 3 imagens são definidas em `docker-compose.prod.yml`:

| Serviço | Imagem | Dockerfile | Tag padrão |
|---------|--------|------------|------------|
| `app` | `ghcr.io/melgarafael/deskcommcrm:stable` | `Dockerfile` | `:stable` |
| `worker` | `ghcr.io/melgarafael/deskcomm-worker:stable` | `Dockerfile.worker` | `:stable` |
| `scheduler` | `ghcr.io/melgarafael/deskcomm-scheduler:stable` | `Dockerfile.scheduler` | `:stable` |

### Build local (escape de emergência)
```bash
cd C:\Jaislan\Projects\DeskcommCRM-v1.80-merge

# App (Next.js standalone, Turbopack)
docker build --build-arg APP_VERSION=v1.80.0 --build-arg APP_REVISION=$(git rev-parse --short HEAD) -t ghcr.io/melgarafael/deskcommcrm:v1.80.0-test .

# Worker (tsx direto, sem build)
docker build -f Dockerfile.worker --build-arg APP_VERSION=v1.80.0 -t ghcr.io/melgarafael/deskcomm-worker:v1.80.0-test .

# Scheduler (busybox crond)
docker build -f Dockerfile.scheduler --build-arg APP_VERSION=v1.80.0 -t ghcr.io/melgarafael/deskcomm-scheduler:v1.80.0-test .
```

### Doutrina de packaging (NÃO NEGOCIÁVEL)
1. **Nenhum serviço de produção constrói na máquina do cliente.** Todo serviço declara `image:` de imagem publicada; `build:` só existe ao lado como escape.
2. **Publicação é ato do CI.** Nunca da máquina local.
3. **Instalação de cliente aponta para número de versão, nunca para tag móvel.** `:stable` = última release, `:latest` = topo da `main`.

---

## 4. HEALTH CHECK PÓS-DEPLOY

### Verificações obrigatórias
```bash
# 1. Contêineres saudáveis
docker compose -f docker-compose.prod.yml ps

# 2. Domínio responde 200 na raiz (página pública)
curl -sI https://$DOMAIN/ | head -5

# 3. /app responde 307 (redireciona pro login), não 404
curl -sI https://$DOMAIN/app | head -5

# 4. Health check do app (probe TCP interno)
curl -s http://localhost:3000/api/v1/health | jq .

# 5. Worker saudável
curl -s http://localhost:8787/healthz

# 6. WAHA conectado
curl -s -H "X-Api-Key: $WAHA_API_KEY" http://localhost:3001/api/sessions | jq .
```

### Sinais de falha crítica
- **404 page not found:** contêiner sem labels de roteamento Traefik (omitir `-f docker-compose.traefik.yml`)
- **502 Bad Gateway:** app não está ouvindo na porta 3000 ou health check falhando
- **WAHA STOPPED:** sessões pareadas não retomaram (`WHATSAPP_RESTART_ALL_SESSIONS=True`)

---

## 5. ROLLBACK

### Procedimento de rollback rápido
```bash
# 1. Parar stack atual
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml down

# 2. Reverter tags no .env para versão anterior (ex.: v1.79.0)
#    APP_IMAGE=ghcr.io/melgarafael/deskcommcrm:v1.79.0
#    WORKER_IMAGE=ghcr.io/melgarafael/deskcomm-worker:v1.79.0
#    SCHEDULER_IMAGE=ghcr.io/melgarafael/deskcomm-scheduler:v1.79.0

# 3. Subir com versão anterior
docker compose -f docker-compose.prod.yml -f docker-compose.traefik.yml --env-file .env up -d

# 4. Verificar saúde
docker compose -f docker-compose.prod.yml ps
```

### Rollback de banco (se migration quebrar)
```bash
# Restaurar backup pré-atualização
pg_restore -h <SUPABASE_HOST> -U postgres -d deskcomm --clean --if-exists D:\BACKUPSGERAL\DeskcommCRM\backup-pre-v1.80.0-*.dump
```

### Pontos de atenção
- Rollback de código **não desfaz** migration aplicada no banco
- Se migration alterou schema, rollback de código pode quebrar por incompatibilidade
- Sempre testar rollback num ambiente isolado antes de aplicar em produção

---

## 6. REVISÃO DE SEGURANÇA DAS MUDANÇAS CLAUDE

### Arquivos críticos modificados no merge
O merge trouxe mudanças de v1.80.0 em arquivos sensíveis:

| Arquivo | Tipo de mudança | Risco |
|---------|----------------|-------|
| `lib/agent-engine/agent/inbound-turn.ts` | Guardrails LIA removidos, promise evidence system | Médio |
| `lib/relogio/executar.ts` | Automações e scheduler | Baixo |
| `lib/system/crivo-*.ts` | Monitoramento upstream | Baixo |
| `app/api/v1/system/update/route.test.ts` | Testes de rota de atualização | Baixo |

### Verificações de segurança obrigatórias
1. **RLS em toda tabela tenant-aware:** rodar `pnpm test:db` para exercitar isolamento entre organizações
2. **Funções security definer não expostas:** rodar `tests/invariants/hardening-definer-varredura.test.ts`
3. **Audit log append-only:** verificar que `anon`, `authenticated` e `service_role` não têm DELETE/UPDATE/TRUNCATE em `api_audit_log`
4. **Bearer tokens hash SHA256:** nenhum plaintext armazenado no DB
5. **API keys apenas em header:** nunca em query string

### Comando de verificação completa
```bash
cd C:\Jaislan\Projects\DeskcommCRM-v1.80-merge
pnpm gov:verify  # typecheck + lint + test:unit
pnpm test:db     # invariantes RLS + baseline
```

---

## 7. CONFIRMAÇÃO: restart=unless-stopped EM TODOS OS CONTÊINERS

### Verificação no compose
Todos os serviços em `docker-compose.prod.yml` confirmados com `restart: unless-stopped`:

- ✅ `app` (linha 58)
- ✅ `worker` (linha 125)
- ✅ `waha` (linha 161)
- ✅ `redis` (linha 204)
- ✅ `srh` (linha 226)
- ✅ `scheduler` (linha 252)
- ✅ `wacalls` (linha 309, profile `voz`)
- ✅ `asterisk` (linha 379, profile `telefonia`)
- ✅ `voice-agent` (linha 419, profile `telefonia`)
- ✅ `caddy` (linha 438)

### Comportamento esperado
- Contêiner morre → reinicia automaticamente
- Contêiner parado manualmente (`docker stop`) → **não** reinicia
- VPS reinicia → contêiner sobe sozinho (depende do daemon Docker, não do systemd)

---

## 8. PRÉ-REQUISITOS ANTES DO DEPLOY

### Checklist obrigatório
- [ ] Backup do banco concluído em `D:\BACKUPSGERAL\DeskcommCRM\`
- [ ] Baseline aplicado com sucesso no scratch-pg (segunda passada verde)
- [ ] 3 imagens construídas localmente (app, worker, scheduler)
- [ ] `pnpm gov:verify` verde no worktree de merge
- [ ] `pnpm test:db` verde (invariantes RLS)
- [ ] Health check validado em ambiente local/staging
- [ ] Plano de rollback testado mentalmente
- [ ] Aprovação explícita do Jaislan ("sim")

### Comando final de preparação
```bash
cd C:\Jaislan\Projects\DeskcommCRM-v1.80-merge

# Verificar status git
git status

# Verificar que não há segredos no diff
git diff --name-only | grep -vE '\.env|secret|key|token'

# Rodar gates locais
pnpm gov:verify
pnpm test:db
```

---

## 9. NOTAS IMPORTANTES

### Sobre o arquivo PROMPTS_EQUIPE_ATUALIZACAO_v1.80.0.md
O arquivo solicitado **não existe** no repositório. Este plano foi elaborado baseado em:
- Doutrina de migrations do `CLAUDE.md`
- Doutrina de packaging do `docs/doctrine/packaging.md`
- Estrutura do `docker-compose.prod.yml`
- Estado atual do worktree de merge

### Worktrees ativos relacionados à v1.80.0
- `C:\Jaislan\Projects\DeskcommCRM-v1.80-merge` → branch `atualizacao/dono-v1.80.0` (ESTE worktree)
- `D:\Jaislan\Sandboxes\DeskcommCRM\atualizacao-v1.80.0` → branch `atualizacao/v1.80.0` (sandbox com merge commit `cbcca2a04`)

### Próximos passos
1. Aguardar aprovação explícita do Jaislan ("sim")
2. Executar backup do banco de produção
3. Aplicar baseline no banco de produção
4. Construir imagens (ou puxar do registry se já publicadas pelo CI)
5. Deploy com health check
6. Monitorar logs por 24h

---

**Documento gerado em:** 2026-10-15  
**Responsável pela execução:** Aguardando aprovação do Jaislan  
**Contato para dúvidas:** Via sessão original ou Telegram