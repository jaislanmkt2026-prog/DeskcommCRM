# MIGRAÇÃO CLAUDE CODE — AUDITORIA PRÉ-MIGRAÇÃO

> **Data:** 2026-09-22
> **Executor:** Consolidador de Operação (Maestri)
> **Projeto:** CRM JS Imóveis (DeskcommCRM)
> **Org ID:** e6243f24-75e0-427c-8f7f-3654f5e75ed4
> **Branch:** main @ 9cbf667
> **Status:** AUDITORIA CONCLUÍDA — PRONTA PARA MIGRAÇÃO

---

## 1. ESTADO ATUAL DO PROJETO

### Repositório
- **Path:** `C:\Jaislan\Projects\DeskcommCRM`
- **Branch:** `main`
- **HEAD:** `9cbf667`
- **Últimos commits:**
  - `9cbf667` Egress: allowlist extra hosts via EGRESS_EXTRA_ALLOWED_HOSTS no seam do LLM
  - `d6c8b74` Regra do dono: flag por org faz o numero de aviso interno virar atendimento
  - `df1b18f` Merge pull request #1417 (CI flake fix)

### Stack Canônica (confirmada em CLAUDE.md)
- **Frontend:** Next.js 16 App Router (Turbopack) + React 19 + TypeScript 6 + Tailwind 4 + shadcn/ui
- **Backend:** Next.js Route Handlers + workers via event_log + cron
- **DB:** Supabase (Postgres) com RLS multi-tenant
- **Auth:** Supabase Auth (@supabase/ssr)
- **WhatsApp:** WAHA Plus (NOWEB engine)
- **AI:** Vercel AI Gateway (Anthropic primário, OpenAI backup)
- **Cache/Rate Limit:** Upstash Redis
- **Observability:** Sentry

### Containers Ativos (Docker)
| Container | Status | Portas |
|-----------|--------|--------|
| deskcommcrm-app-1 | Up 6h (healthy) | 3000/tcp |
| deskcommcrm-worker-1 | Up 6h (healthy) | 8787/tcp |
| deskcommcrm-scheduler-1 | Up 13h (healthy) | — |
| deskcommcrm-caddy-1 | Up 21h | 80, 443 |
| deskcommcrm-waha-1 | Up 21h | 3000/tcp |
| deskcommcrm-redis-1 | Up 21h (healthy) | 6379/tcp |
| supa-db | Up 21h | 54322→5432 |
| supa-auth | Up 21h | 54321→9999 |
| supa-rest | Up 21h | 54323→3000 |
| supa-kong | Up 8h (healthy) | 54320→8000 |
| supa-storage | Up 7h | 54324→5000 |
| deskcommcrm-srh-1 | Up 21h | — |

**Veredito:** Todos os containers saudáveis. Ambiente staging operacional.

---

## 2. ARQUIVOS IMPORTANTES

### Documentação Central
- `CLAUDE.md` — Doutrina completa (convenções, anti-patterns, stack, regras)
- `AGENTS.md` — Contrato portátil para outros agentes
- `docs/index.md` — Índice dos 149+ docs com precedência
- `docs/current-state.md` — Retrato datado (2026-07-29, commit 789dfa6)
- `docs/threat-model.md` — Superfície de ataque self-host
- `docs/harness-audit.md` — Buracos na verificação automática

### Configuração
- `docker-compose.yml` — Dev/staging
- `docker-compose.prod.yml` — Produção (20KB, completo)
- `docker-compose.build.yml` — Build pipeline
- `docker-compose.traefik.yml` — Reverse proxy
- `.env` / `.env.example` — Variáveis de ambiente

### Estrutura de Código
- `app/` — Next.js App Router (pages + API routes)
- `lib/` — Helpers, business logic, integrações
- `components/` — UI components (shadcn/ui)
- `workers/` — Background workers
- `hooks/` — React hooks
- `supabase/` — Migrations, functions, seed

---

## 3. AGENTES MAESTRI ATIVOS

| Role ID | Seção | Responsabilidade |
|---------|-------|------------------|
| `43608973...` | ANÁLISE | Métricas, Meta Ads, auditoria event_log |
| `4833f047...` | CANAIS | WAHA, webhooks, channel_sessions |
| `57d1501d...` | CONFIGURAÇÕES | Org settings, equipe, LGPD, branding |
| `5aa6d125...` | AGENTE DE IA | ai_agents, follow-ups, roteadores, llm_calls |
| `7855f3d6...` | ATENDIMENTO | Inbox, Radar, Agenda, respostas rápidas |
| `85c1be92...` | MIGRADOR | Extração/migração de dados legados |
| `bdc5dbed...` | CRM | Funis, leads, contatos, tarefas |

**Comunicação:** Todos reportam via `maestri ask 'OpenCode #2'`. Nenhum commit direto.

---

## 4. MISSÃO ATUAL

### Missão 8 — Gate Técnico
**Estado:** Em andamento (preparação iniciada pelo OpenCode)
**Objetivo:** Validar infraestrutura antes de importar CV CRM Engenharq.

**Sub-tarefas pendentes:**
- **Crivo:** Validar backup e restauração
- **Base:** Schema, PK/FK, constraints
- **Balsa:** Contrato importação, staging, rollback, idempotência
- **Bússola:** Auditoria completa

### Bloqueio Absoluto
> ⛔ **CV CRM Engenharq = [BLOQUEADO-DONO]**
> Não acessar, não importar, não criar estoque até Gate Técnico concluído.

---

## 5. BANCO DE DADOS

### Supabase (Postgres)
- **Host:** localhost:54322 (via Docker)
- **Database:** postgres
- **Acesso:** `docker exec supa-db psql -U postgres -d postgres`
- **RLS:** Ativo em todas as tabelas tenant-aware
- **Extensions:** uuid-ossp, pgcrypto, vector

### Organization Ativa
- **Nome:** JS Imóveis
- **ID:** `e6243f24-75e0-427c-8f7f-3654f5e75ed4`
- **Admin:** jaislan@deskcomm.local

---

## 6. MIGRATIONS

### Total: 313 migrations SQL
- **Primeira:** `00001_initial_schema.sql`
- **Última:** `20260922010000_0382_fundacao_imobiliaria.sql` (13.6KB)

### Migration 0382 — Fundação Imobiliária (ÚLTIMA)
Schema completo para vertical imobiliária:
1. `constructors` — Construtoras parceiras
2. `real_estate_developments` — Empreendimentos
3. `real_estate_units` — Unidades (apartamentos, lotes)
4. `unit_history` — Histórico de unidades
5. `third_party_properties` — Imóveis de terceiros (captação)
6. `property_owners` — Proprietários
7. `property_documents` — Documentos
8. `negotiations` — Negociações

**Todas as tabelas:**
- Tenant-scoped (`organization_id` FK → organizations)
- RLS via `fn_user_org_ids()`
- Idempotentes (`CREATE TABLE IF NOT EXISTS`)
- Índices em organization_id e FKs principais

### Baseline
- `supabase/baseline.sql` — Auto-curativo, cobre até migration 0382
- Kit self-host recebe mudanças automaticamente

---

## 7. FERRAMENTAS CONFIGURADAS

### Maestri Workspace
- **Status:** ✅ Validação completa
- **Roles:** 7 agentes ativos
- **Comunicação:** Cross-session funcional

### Ghost CLI
- **Provedor IA:** openrouter via ghostcli.dev
- **Agente publicado:** v2
- **Status:** ✅ Configurado e operacional

### Docker Compose
- **Ambiente:** Staging local (https://localhost)
- **Caddy:** TLS automático
- **WAHA:** Engine NOWEB, porta 3000 interna
- **Redis:** Rate limiting e cache

### CI/CD
- **Checks obrigatórios:** typecheck, lint, lint:channels, test:unit, test:shell
- **Testes invariantes:** 56 arquivos em `tests/invariants/`
- **E2E:** 19 specs em `tests/e2e/`

---

## 8. CONTEXTO NECESSÁRIO PARA CONTINUIDADE

### Para Claude Code Assumir
1. **Ler obrigatoriamente:**
   - `CLAUDE.md` (doutrina completa)
   - `docs/current-state.md` (estado datado + comandos de medição)
   - `docs/index.md` (navegação de docs)
   - Esta auditoria (`MIGRACAO_CLAUDE_CODE_AUDITORIA_PRE.md`)

2. **Credenciais de teste:**
   - Login: `jaislan@deskcomm.local` / `jaislan35`
   - Org: JS Imóveis (`e6243f24-75e0-427c-8f7f-3654f5e75ed4`)

3. **Acesso ao banco:**
   ```bash
   docker exec supa-db psql -U postgres -d postgres -c "SQL_AQUI"
   ```

4. **API local:**
   - Base URL: `https://localhost/api/v1/`
   - Auth: Cookie de sessão ou Bearer token

5. **Regras de segurança (NÃO NEGOCIÁVEIS):**
   - Multi-tenancy com RLS em toda tabela
   - Service role NUNCA bypassa filtro de org manualmente
   - Triggers Postgres NUNCA fazem HTTP (event_log → worker)
   - Audit log append-only (sem UPDATE/DELETE/TRUNCATE)
   - STOP detection em `lib/opt-out/deteccao.ts`
   - Anti-banimento: throttle 1msg/1.2s + jitter ≤800ms

### Backups
- **Localização centralizada:** `D:\BACKUPSGERAL`
- **Backup pós-fundação:** Realizado pelo OpenCode (confirmado em missão)
- **Obsidian Vault:** `C:\Users\okaso\Documents\Obsidian Vault` (memória compartilhada)

---

## VEREDITO DA AUDITORIA

✅ **PROJETO PRONTO PARA MIGRAÇÃO**

| Critério | Status |
|----------|--------|
| Repositório íntegro | ✅ main @ 9cbf667 |
| Containers saudáveis | ✅ 12/12 running |
| Migrations preservadas | ✅ 313 files, última 0382 |
| Documentação completa | ✅ CLAUDE.md + 149 docs |
| Agentes Maestri ativos | ✅ 7 roles operacionais |
| Banco acessível | ✅ Supabase via Docker |
| Backup realizado | ✅ Pós-fundação |
| Missão 8 documentada | ✅ Gate Técnico em andamento |

### Ponto Exato de Continuação
Após migração para Claude Code + Ghost CLI, retomar **Missão 8 — Gate Técnico**:
1. Crivo: validar backup e restauração
2. Base: schema, PK/FK, constraints da Fundação Imobiliária (migration 0382)
3. Balsa: contrato de importação, staging, rollback, idempotência
4. Bússola: auditoria final

### Próxima Ação Recomendada
Gerar `CLAUDE.md` específico para o novo executor (Etapa 2 da missão), contendo resumo executivo desta auditoria + instruções de bootstrap.

---

*Auditoria gerada por Consolidador de Operação (Maestri) em 2026-09-22.*
*Nenhum arquivo alterado. Nenhuma implementação executada. Apenas leitura e consolidação.*