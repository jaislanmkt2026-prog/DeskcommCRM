# Resultado — ATLAS CV v1.80.0

**Data:** 2026-10-15 
**Worktree:** `C:\Jaislan\Projects\DeskcommCRM-v1.80-merge` 
**Branch:** `atualizacao/dono-v1.80.0`

---

## 1. Migrations 0651–0653 (confirmadas)

Três arquivos encontrados em `supabase/migrations/`:

| # | Arquivo | Descrição |
|---|---------|-----------|
| 0651 | `20261003000600_0651_cv_crm_external_id.sql` | Coluna `external_id` para rastreamento externo do CV CRM |
| 0652 | `20261003000700_0652_cv_crm_staging_ingestion.sql` | Tabela de staging para ingestão de dados do CV CRM |
| 0653 | `20261003120000_0653_fn_apply_cv_crm_valid_records.sql` | Função para aplicar registros válidos da ingestão |

**Status:** Confirmadas no disco. Não foram aplicadas em banco nesta sessão (requer scratch-pg separado).

---

## 2. Domínio CV CRM — revisão

### Arquivos principais tocados por Claude (Missão 8)

- `app/api/v1/system/cv-crm/metrics/route.ts` — rota de métricas agregadas
- `app/api/v1/leads/_handler.ts` — handler com lógica de ingestão, adapter e reconciliação
- `lib/cv-crm/` — módulo de integração (se existir)

### Pontos de atenção identificados

1. **Rota de métricas** (`cv-crm/metrics/route.ts`): lê `cv_crm_ingestion_logs` e conta stale em `real_estate_developments` / `real_estate_units`. Sem exposição de dados brutos. Audit log emitido.
2. **Handler de leads**: contém lógica de ingestão CV CRM com idempotência por `external_id`.
3. **Migrations**: schema novo para staging e função de aplicação de registros válidos.

---

## 3. Correção UTF-8 — `app/api/v1/system/cv-crm/metrics/route.ts`

**Caracteres corrompidos corrigidos (7 trechos):**

| Linha | Antes | Depois |
|-------|-------|--------|
| 9–10 | `Ãºltimas`, `mÃ©dio`, `sensÃ­vel` | `últimas`, `médio`, `sensível` |
| 20–21 | `obrigatÃ³rio`, `usuÃ¡rio`, `vÃª`, `diagnÃ³stico`, `instalaÃ§Ã£o`, `sÃ³` | `obrigatório`, `usuário`, `vê`, `diagnóstico`, `instalação`, `só` |
| 26 | `Ã©`, `obrigatÃ³rio`, `usuÃ¡rios`, `nÃ£o`, `sÃ£o`, `instalaÃ§Ã£o` | `é`, `obrigatório`, `usuários`, `não`, `são`, `instalação` |
| 48 | `perÃ­odo` | `período` |
| 65 | `AgregaÃ§Ãµes`, `memÃ³ria` | `Agregações`, `memória` |
| 77 | `mÃ©dio`, `duraÃ§Ã£o` | `médio`, `duração` |
| 134 | `â€"`, `sensÃ­vel` | `—`, `sensível` |

**Verificação final:** arquivo lido após todas as edições — zero caracteres corrompidos restantes.

---

## 4. Pendências

- **PROMPTS_EQUIPE_ATUALIZACAO_v1.80.0.md:** arquivo não encontrado no worktree. Instruções originais podem ter sido perdidas ou nunca terem sido commitadas nesta branch.
- **Aplicação das migrations em scratch-pg:** requer banco Postgres dedicado fora deste worktree.
- **Teste da rota `/api/v1/system/cv-crm/metrics`:** depende de servidor Next.js rodando e dados seed na tabela `cv_crm_ingestion_logs`.

---

## 5. Próximos passos recomendados

1. Criar banco scratch-pg e aplicar migrations 0651–0653.
2. Seed de dados de teste em `cv_crm_ingestion_logs`.
3. Subir dev server e exercitar a rota de métricas via browser ou curl.
4. Revisar `_handler.ts` de leads para garantir que ingestão CV CRM está intacta após merge.