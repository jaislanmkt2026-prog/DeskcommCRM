# CLAUDE.md — DeskcommCRM
> Instruções pra futuras sessões Claude trabalhando neste repo. Leitura obrigatória antes de qualquer task de código.

**Este arquivo é a doutrina — a autoridade final sobre convenção e anti-pattern.** Complementos, na ordem em que ajudam:
- [`AGENTS.md`](AGENTS.md) — mesmo contrato em forma portátil (para Codex/Cursor/Copilot e afins). É derivado deste arquivo, não o substitui. **Ao mudar doutrina aqui, verifique se `AGENTS.md` desatualizou.**
- [`docs/index.md`](docs/index.md) — índice dos 149 docs, com regra de precedência quando dois docs discordam. Use antes de sair varrendo `docs/`.
- [`docs/current-state.md`](docs/current-state.md) — o que está pronto, incompleto e quebrado. **Leia antes de estimar ou prometer qualquer coisa.**
- [`docs/harness-audit.md`](docs/harness-audit.md) — onde a verificação tem buraco. Importante: `pnpm gov:verify` **não** cobre `test:db` nem `test:e2e` — verde ali não é prova para mudança de schema ou de UI.
- [`docs/threat-model.md`](docs/threat-model.md) — superfície de ataque real do self-host.

---

## Visão (1 parágrafo)
DeskcommCRM é um sistema operacional de vendas open source com agentes de IA nativos — multi-nicho (e-commerce, clínicas, imobiliárias, infoprodutos, serviços), com WhatsApp como canal primário (via WAHA). Agentes com RAG por tenant atendem, qualificam e movem o funil junto com humanos; CRM inteiro exposto via MCP. Monetização = self-host em VPS (parceria HostGator), não assinatura. Arquitetura multi-tenant com RLS desde o dia 1; LGPD nativa. Posicionamento completo: `VISION.md`.

---

## Stack canônica
- **Frontend:** Next.js 16 App Router (Turbopack) + React 19 + TypeScript 6 estrito + Tailwind 4 (config em CSS — ver abaixo) + shadcn/ui (style: `new-york`, neutral)
- **Backend:** Next.js Route Handlers (mesmo repo); workers via `event_log` table + cron
- **DB:** Supabase (Postgres). RLS em toda tabela tenant-aware. Extensions: `uuid-ossp`, `pgcrypto`, `vector`
- **Auth:** Supabase Auth via `@supabase/ssr`. Cookie SameSite=Strict, HttpOnly, Secure
- **Realtime:** Supabase Realtime (postgres_changes + broadcast)
- **Storage:** Supabase Storage (bucket `whatsapp-media` privado, URLs assinadas)
- **WhatsApp:** WAHA Plus, engine NOWEB
- **Filas/eventos:** `event_log` table + workers (não usar Inngest/Trigger no MVP)
- **Rate limit:** Upstash Redis sliding window
- **AI:** Vercel AI Gateway (Anthropic primário; OpenAI backup pra embeddings); strings tipo `"anthropic/claude-sonnet-4-6"`
- **Validação:** Zod em todo input externo (request body, webhook payload, env)
- **Observability:** Sentry com `beforeSend` sanitizado

---

## Convenções críticas (NÃO NEGOCIÁVEIS)

### Multi-tenancy
- `organization_id uuid not null references organizations(id) on delete cascade` em **toda** tabela tenant-aware
- RLS policy `tenant_isolation_<tabela>_all` aplicada via helper `fn_user_org_ids()`
- Service role bypassa RLS — handlers que usam admin client **DEVEM** filtrar `organization_id` manualmente, resolvido de fonte confiável (cookie/JWT/webhook secret/path token), **NUNCA do body**
- Toda query que cruza tabelas tenant-aware filtra `organization_id` explicitamente
- Teste de isolamento (cria 2 tenants, verifica não-vazamento) é obrigatório no CI antes de merge

### Idempotência & event sourcing leve
- Mensagens WhatsApp e eventos externos: `unique (organization_id, external_id)` + captura `code === '23505'` no INSERT
- POSTs de criação na API aceitam header `Idempotency-Key: <uuid>` (TTL 24h via Upstash)
- **Trigger Postgres NUNCA faz HTTP.** Trigger emite linha em `event_log`; worker (cron / Realtime listener) consome e dispara side effect

### API REST `/api/v1/`
- Versionamento por path. JSON snake_case. UUID v4. ISO-8601 UTC. Dinheiro em `_cents` + `currency` ISO-4217
- Wrapper sucesso: `{ data, meta?: { cursor, has_more, total } }`
- Wrapper erro: `{ error: { code, message, details? } }` — usar helpers `ok()` / `fail()` de `lib/api/wrappers.ts`
- Paginação: cursor opaco base64+HMAC por default
- **Auth dual é a direção do produto, e ela se cumpre rota por rota.** Cookie de sessão para o frontend; `Authorization: Bearer dsk_...` (linha de `api_tokens`, resolvida no servidor) para chamada de servidor. O prefixo é **`dsk_`**, e quem o exige é `lib/mcp/auth.ts`
- O helper é `lib/api/auth-dual.ts`, e habilitar uma rota é **por rota**: não há chave geral. Para saber quais já aceitam bearer: `git grep -ln "auth-dual" -- app/api/v1`
- **Chamar o helper na rota não basta:** o `proxy.ts` global roda antes de qualquer handler e só reconhece cookie. Sem uma entrada em `lib/auth/public-paths.ts` para o caminho, todo bearer recebe 401 do proxy antes de chegar ao handler
- **API key NUNCA em query string** (vaza em logs Vercel/CF). Sempre header
- Plaintext de bearer token mostrado **uma vez** na criação; depois apenas hash SHA256 no DB
- Rate limit headers: `X-RateLimit-*` + `Retry-After` em 429
- `X-Request-Id` em toda response (correlaciona com audit log)

### Auth & RBAC
- Sempre `getUser()` (valida JWT no backend). NUNCA `getSession()` (confia no cookie local)
- 4 roles dentro do tenant: `viewer` (1) < `agent` (2) < `manager` (3) < `admin` (4)
- Super-admin de plataforma é uma role transversal — `is_platform_admin` (decisão final na Spec 01)
- MFA TOTP é **opcional e ligado por quem administra** — não é mais forçado por papel. Quem exige são duas políticas independentes que SOMAM: `platform_admins.mfa_required` (para o super-admin) e `organizations.settings.security.mfa_required` (para o `admin` do tenant). O padrão de ambas é **não exigir**, e o `bootstrap-owner.ts` grava `false` explícito. Regra pura em `lib/auth/politica-mfa.ts`
  - **Por que mudou:** o gate era `isPlatformAdmin || role === "admin"`, sem opção, e o `install.sh` cria o dono como platform admin — então TODA instalação self-host recebia um bloqueador de tela cheia logo depois do onboarding, um passo que o wizard nunca anunciou. Decisão do dono do produto; segurança que expulsa o usuário na primeira tela não protege ninguém
  - **⚠️ CADASTRAR e PROVAR são perguntas diferentes.** A política decide o cadastro. Já `mfaEmDivida()` — o 403 `mfa_required` das rotas — NÃO consulta a política: quem TEM fator prova na sessão, sempre. Ligá-lo à política faria quem ativa a verificação por vontade própria ter o fator ignorado
  - Ligar/desligar vive em **Configurações › Segurança**; desligar o próprio fator exige sessão `aal2` (senão uma sessão roubada desliga a proteção com um clique)
- Permissão por pipeline (`user_pipeline_access`) **NÃO** entra no MVP
- Suporte temporário: todo handler mutante de `app/api/v1` declara `requireSupportWrite(`
  de `lib/impersonate/support.ts` **antes do efeito**. É guarda de efeito, não de papel — não substitui
  `requireRole`/RBAC/MFA — e é cobrada pelo gate `tests/unit/suporte-cobertura-de-efeitos.test.ts`

### Audit log
- Toda mutação POST/PATCH/DELETE bem-sucedida → 1 entrada em `api_audit_log` (fire-and-forget, p99 ≤500ms)
- **Rodada de cron que não fez nada NÃO é mutação e não audita**
- Audit é append-only para os papéis do PostgREST (`anon`, `authenticated`, `service_role` não têm GRANT de UPDATE, DELETE nem TRUNCATE)
- Retenção default de 5 anos, configurável via `AUDIT_LOG_RETENTION_DAYS`, executada por `fn_expurgar_auditoria_vencida`

### LGPD
- Anonimização preferida sobre delete. Nome do contato vira `Cliente Anonimizado #N`
- Cascade de redact: contact + conversations + messages + activities
- Reversão de anonimização: 403 `lgpd_anonymization_irreversible`
- SLA: data_request entregue D+7; redact executado D+15

### WAHA
- Default fixo `devlikeapro/waha:latest-2026.7.2`, NOWEB
- Auth: env do WAHA recebe **hash SHA512 hex** da api key; cliente envia plaintext em `X-Api-Key`
- Webhooks: HMAC SHA512 com `crypto.timingSafeEqual`
- Anti-banimento: throttle 1 msg/1.2s + jitter ≤800ms. Campanha 1 msg/5s. Warm-up 7-14d. Janela 7h-22h
- STOP detection: regra em `lib/opt-out/deteccao.ts` — bloqueia palavra ISOLADA ou verbo de cessação com OBJETO DE COMUNICAÇÃO
- Mídia: subir pro Supabase Storage primeiro, passar URL ao WAHA (não inline base64)

### Marca própria (white-label)
- **Uma imagem Docker serve todas as marcas.** Nada de `NEXT_PUBLIC_*` para marca
- **O banco está ACIMA do `.env`.** `platform_branding` e `organizations.settings.branding` são a fonte
- **Resolvedor NUNCA lança.** Degrada para o padrão do produto
- **O PDF de LGPD NUNCA leva marca.** Nomeia o controlador (`organizations.legal_name`) e o DPO

### Doutrina DIRC (antes de adicionar campo)
- **D**uplicar — vive aqui mesmo?
- **I**ntegrar — vem de outra tabela via FK?
- **R**eferenciar — só ponteiro?
- **C**alcular — pode ser computado on-demand?

### Modelagem
- 5 tabelas core CRM: `crm_pipelines`, `crm_stages`, `crm_leads`, `crm_lead_activities`, `crm_lead_links`
- `position_in_stage numeric` (fractional indexing via `midpoint()`) — **NUNCA `int`**
- `external_id` nullable
- `type` é `text` + `check constraint`, **não enum**
- `tags text[]` + GIN index
- `custom_fields jsonb` com schema declarativo em `pipeline.settings.fields`
- `vocabulary jsonb` em pipeline permite renomear lead/deal/won/lost

---

## Anti-patterns proibidos
1. String que deveria ser FK (ex: `owner_email text` em vez de `owner_user_id uuid`)
2. Duplicação sem source of truth declarado
3. Evento sem consumer (emite e ninguém escuta)
4. FK ausente que vira inferência por nome
5. Campo sincronizado por cron quando devia ser realtime/trigger
6. `jsonb` lock-in (UI lê path direto sem schema central)

---

## MIGRAÇÃO DE EXECUTOR (2026-09-22)

> **Contexto:** Migração controlada de OpenCode para Claude Code + Ghost CLI.
> **Auditoria Pré-Migração:** [`docs/MIGRACAO_CLAUDE_CODE_AUDITORIA_PRE.md`](docs/MIGRACAO_CLAUDE_CODE_AUDITORIA_PRE.md)
> **Ponto Exato de Continuação:** Missão 8 — Gate Técnico (Crivo/Base/Balsa/Bússola).

### Estado na Transição
- **Branch:** main @ 9cbf667
- **Containers:** 12/12 saudáveis (app, worker, scheduler, caddy, waha, redis, supa-*)
- **Migrations:** 313 arquivos (última: 0382_fundacao_imobiliaria)
- **Agentes Maestri:** 7 roles ativos (Análise, Canais, Config, IA, Atendimento, Migrador, CRM)
- **Bloqueio Absoluto:** CV CRM Engenharq = [BLOQUEADO-DONO] até Gate Técnico concluir

### Instruções para Novo Executor
1. Leia esta doutrina inteira antes de qualquer ação
2. Leia a auditoria pré-migração para estado detalhado
3. Retome Missão 8 exatamente onde OpenCode parou
4. Reporte via `maestri ask 'OpenCode #2'` (mesmo canal dos agentes anteriores)
5. Nenhum arquivo foi perdido; nenhuma reinicialização necessária