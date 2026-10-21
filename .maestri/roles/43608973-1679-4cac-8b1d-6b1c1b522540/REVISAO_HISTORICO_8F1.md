# MISSÃO 8F.1.1 — REVISÃO DO MODELO DE HISTÓRICO (Migrations 0383 + 0384)

## Veredito: **APROVADO**

## Validação dos 4 Pontos

### 1) Modelo histórico cobre ciclo de vida completo da proposta (draft→sent→accepted→rejected→expired)?
**SIM.** Migration 0383, linha 23: constraint `CHECK (status IN ('draft','sent','accepted','rejected','expired'))`. Trigger de histórico (0384, linhas 124-137) captura INSERT, UPDATE e DELETE em `property_proposals`, registrando todas as transições de status.

### 2) Modelo histórico cobre ciclo de vida da reserva (active→cancelled→expired→converted)?
**SIM.** Migration 0383, linha 90: constraint `CHECK (status IN ('active','cancelled','expired','converted'))`. Trigger de histórico (0384, linhas 142-155) captura INSERT, UPDATE e DELETE em `property_reservations`, registrando todas as transições de status.

### 3) Vínculo Cliente→Proposta→Reserva→Histórico preservado?
**SIM.**
- `property_proposals_history.parent_id` → FK para `property_proposals.id` (linha 20 da migration 0384)
- `property_reservations_history.parent_id` → FK para `property_reservations.id` (linha 56 da migration 0384)
- `property_proposals.client_id` → FK para `contacts(id)` (linha 24 da migration 0383)
- `property_reservations.proposal_id` → FK para `property_proposals(id)` (linha 91 da migration 0383)

Cadeia completa: `contacts` → `property_proposals` → `property_reservations` → tabelas de histórico via `parent_id`.

### 4) Campos old_values/new_values jsonb capturam todas as transições relevantes?
**SIM.** Função `fn_track_proposal_reservation_history()` (linhas 82-119 da migration 0384):
- INSERT: `old_values = NULL`, `new_values = to_jsonb(NEW)`
- UPDATE: `old_values = to_jsonb(OLD)`, `new_values = to_jsonb(NEW)`
- DELETE: `old_values = to_jsonb(OLD)`, `new_values = NULL`

Captura snapshot completo da linha antes e depois de cada operação, permitindo reconstruir estado em qualquer ponto do tempo.

## Observações Técnicas

- **RLS nas tabelas de histórico:** políticas usam `EXISTS` com subquery para herdar isolamento do tenant da tabela pai. Correto.
- **Índices:** `parent_id` e `changed_at` indexados em ambas tabelas de histórico. Permite query eficiente por entidade e por período.
- **Trigger AFTER:** garante que o registro só é persistido se a operação principal succeeds. Correto.
- **auth.uid() como changed_by:** rastreia qual usuário fez a mudança. Em operações internas (cron, trigger), pode ser NULL — aceitável.

## Status

- [x] Revisão documentada
- [x] Veredito: APROVADO
- [ ] Migrations aplicadas ao banco (próximo passo operacional)

---

**Evidência:** Leitura das migrations `20260922215820_0383_property_proposals_reservations.sql` (linhas 1-135) e `20260922220000_0384_property_proposals_reservations_history.sql` (linhas 1-157).

**Data:** 2026-09-23

**Nenhuma alteração nas migrations.** Apenas revisão.