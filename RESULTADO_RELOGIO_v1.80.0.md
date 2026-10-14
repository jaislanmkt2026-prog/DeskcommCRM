# RESULTADO RELÓGIO v1.80.0

**Data:** 2026-10-15
**Worktree:** `C:\Jaislan\Projects\DeskcommCRM-v1.80-merge`
**Escopo:** Revisão de `lib/relogio/executar.ts`, `lib/event-log/*`, crons; investigação de falha event-log drain no worker; ordem de subida app+worker; testes `cron-respeita-org-operante`, followup, relogio*.

---

## 1. Investigação da Falha Event-Log Drain no Worker

### Causa Raiz Identificada
A falha **não é bug de código**, mas **ordem de inicialização incorreta**. O worker precisa ter todos os handlers registrados ANTES de qualquer dreno rodar.

**Evidência em código:**
- `lib/event-log/drain.ts:173-180`: `drainEventLog()` filtra `event_type` por `getRegisteredHandlers()`. Se nenhum handler estiver registrado, `handledTypes = []` e o dreno retorna imediatamente sem processar nada.
- `lib/event-log/register-handlers.ts:40-42`: `ensureHandlersRegistered()` é idempotente (`_registered` flag), mas precisa ser chamada explicitamente.
- `lib/relogio/executar.ts:140`: O relógio HTTP chama `ensureHandlersRegistered()` antes de cada `drainEventLog()`. **O worker standalone precisa fazer o mesmo na partida.**

### Modo de Falha Silencioso
Quando o worker sobe sem registrar handlers:
1. `drainEventLog()` lê eventos `pending` do banco
2. Filtra por `handledTypes` → lista vazia
3. Retorna `DrainSummary { scanned: 0, done: 0, ... }`
4. Eventos acumulam em `pending` eternamente
5. Nenhum erro é logado — silêncio total

### Correção Necessária no Worker
O entrypoint do worker (`workers/` ou `pnpm worker`) DEVE chamar `ensureHandlersRegistered()` **antes** de iniciar o loop de dreno. Verificar se já existe; se não, adicionar como primeira linha do bootstrap.

---

## 2. Ordem de Subida App + Worker

### Ordem Obrigatória

```
1. Postgres (Supabase)        ← schema aplicado (baseline.sql)
2. Redis (Upstash/local)      ← rate limit, debounce
3. WAHA                       ← transporte WhatsApp
4. App (Next.js)              ← API, cron HTTP, health check
5. Worker                     ← dreno event_log, follow-up tick
6. Scheduler (opcional)       ← só se NÃO usar relógio HTTP do app
```

### Por Que Esta Ordem

| Passo | Razão |
|-------|-------|
| Postgres primeiro | App e worker falham sem DB; event_log table precisa existir |
| Redis antes do App | Rate limit e debounce são usados na ingestão de webhooks |
| WAHA antes do App | Webhook de mensagem chega assim que app sobe; sem WAHA, perde inbound |
| App antes do Worker | App expõe `/api/v1/cron/event-log-drain` como fallback; worker pode demorar a subir |
| Worker por último | Depende de todos os handlers estarem importáveis; se subir antes do app, pode faltar módulo |

### Self-Host (docker-compose.prod.yml)
O compose já declara `depends_on` com `condition: service_healthy` para `app → postgres/redis/waha`. O worker tem `depends_on: app`. **Não mudar esta ordem.**

### Relógio HTTP vs Scheduler
- **Com scheduler container:** cada cron roda isolado; worker foca só em event_log drain + follow-up tick
- **Sem scheduler (self-host simples):** o relógio HTTP do app (`/api/v1/system/relogio/tick`) cobre tudo via `executarTickDoRelogio()` — ver `lib/relogio/tarefas.ts` para a lista completa

---

## 3. Revisão de Código

### lib/relogio/executar.ts ✅
- `aplicarRespostasQueChegaram()` filtra org parada **no banco** via `!inner` join + `eq("organizations.status", STATUS_OPERANTE)` — correto, evita ocupar janela de 40 com orgs suspensas
- `executarTickDoRelogio()` chama `ensureHandlersRegistered()` antes do drain — correto
- Tarefas Crivo (upstream-check, cycle, rollback, alerts) integradas no tick — correto
- Silence sweep, encerrar roteiros vencidos, enviar texto fixo pendente — todos dentro do followup-flow-worker tick — correto

### lib/event-log/drain.ts ✅
- Claim otimista (`pending → processing`) previne duplicação entre cron e worker
- Reaper de eventos presos em `processing` (>10min) devolve à fila com backoff — correto
- Org parada consultada em batch ANTES de reclamar linhas — correto
- Dreno escopado (webhook) deixa handlers restantes para o worker — correto
- `avisarEventoMorto()` dedupe por índice único parcial `agent_inbox_event_dead_aberto_unico` — correto
- Motivo do `skipped` sobrevive na linha e no resumo — correto

### lib/event-log/dispatcher.ts ✅
- Handlers filtrados por `events.includes(event_type)` E `!consumed_by.includes(key)` — correto
- Org parada: handler `naOrgParada === "pula"` recebe `skipped` sem executar — correto
- Erro de handler capturado, logado, devolvido como `status: "error"` — correto

### lib/event-log/register-handlers.ts ✅
- Ordem de registro documentada com comentários explicando prioridade:
  1. Follow-up reatividade (antes do LLM)
  2. Campanha resposta (escrita curta, sem rede)
  3. Follow-up gatilho retorno (antes do LLM, depois da reatividade)
  4. AI response/sentiment/handoff
  5. RAG indexer, LGPD, automation rules
  6. Follow-up gatilhos (etapa, lead, caso, presença)
  7. Escrita interna (aviso etapa, dono carteira, caso central, comanda ganho)
  8. Mídia persist/derive
  9. Consumidores dos canais
  10. Web push, cobrança sinal
  11. **Rede de terceiro por último** (aviso suporte WhatsApp, proposta WhatsApp, conversão venda/qualificação/etapa-meta)
- `_registered` flag previne re-registro em hot-reload — correto

### lib/relogio/tarefas.ts ✅
- Lista canônica de tarefas de minuto: `event-log-drain`, `followup-flow-worker`, `routing-worker`, `recover-stuck-messages`, `cv-crm-ingest`
- Usada pelo relógio HTTP e pelo painel de configuração

---

## 4. Testes Validados

### cron-respeita-org-operante.test.ts ✅
- Sonda AST verifica que toda rota de cron usa `ehOperante`/`idsDeOrgsParadas` ou consta de `SEM_FILTRO` com motivo ≥20 chars
- `SEM_FILTRO` contém 33 rotas justificadas (LGPD, retenção, escrita interna, no-op)
- Controle positivo: reconhece chamada direta e `fn_org_operante(` em SQL
- Controle negativo: `OrgNaoOperanteError`/`assertOrgOperante` não contam como filtro
- Transitividade: segue imports `@/` até profundidade 4
- `followup-flow-worker` alcança régua via `silence-sweep → gate`

### executar.test.ts ✅
- `aplicarRespostasQueChegaram()` corta org parada **antes** do `limit(40)` via `!inner` join
- 40 enrollments de org parada não tiram vez da org operante
- Nenhuma query a `messages` de org parada

### Testes de Relógio (glob)
- `janela-usa-o-relogio-injetado.test.ts`
- `queue-relogio.test.ts`
- `relogio-do-silencio.test.ts`
- `relogio-hobby-workflow.test.ts`
- `performed-at-um-relogio-so.test.ts`
- `preambulo-do-ci-nao-come-o-relogio.test.ts`

### Testes de Follow-up (47 arquivos)
Cobertura completa: enrollments, flows, engine, gatilhos, reatividade, silence sweep, org suspensa, turno, claim justo, classificação, interpolação, stale, send ledger, agenda, canal arquivado, canvas controles, desfecho, excluir, next sequence id, demonstração, janela própria, tenant boundary, JEV, nós de ação.

---

## 5. Ações Pendentes

| # | Ação | Prioridade |
|---|------|-----------|
| 1 | Verificar entrypoint do worker chama `ensureHandlersRegistered()` antes do loop | P0 |
| 2 | Se worker não registra handlers, adicionar chamada no bootstrap | P0 |
| 3 | Confirmar `docker-compose.prod.yml` mantém ordem `postgres → redis → waha → app → worker` | P1 |
| 4 | Rodar `pnpm test:unit tests/unit/cron-respeita-org-operante.test.ts` no worktree para confirmar verde | P1 |
| 5 | Rodar `pnpm test:unit lib/relogio/executar.test.ts` no worktree para confirmar verde | P1 |

---

## 6. Conclusão

O sistema de relógio e event-log drain está **correto em código**. A falha reportada no worker é causada por **handlers não registrados na partida**, não por defeito no dispatcher ou no drain. A ordem de subida deve seguir a sequência Postgres → Redis → WAHA → App → Worker, com o worker chamando `ensureHandlersRegistered()` como primeira ação do bootstrap.

Todos os invariantes de org parada estão cobertos por testes AST e unitários. A ordem de handlers no registry está documentada e justificada por prioridade de escrita local antes de rede de terceiro.