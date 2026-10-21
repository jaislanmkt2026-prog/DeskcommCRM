# MISSÃO 8F.1 — REVISÃO DO MODELO (Migration 0383)
## Veredito: **APROVADO**
## Validação dos 4 Pontos
### 1) property_proposals pertence ao cliente?
**SIM.** Linha 14: `client_id uuid NOT NULL` + linha 24: FK `REFERENCES contacts(id) ON DELETE CASCADE`. Proposta é entidade vinculada ao cliente (contact).
### 2) property_reservations pertence à negociação (proposta)?
**SIM.** Linha 80: `proposal_id uuid NOT NULL` + linha 91: FK `REFERENCES property_proposals(id) ON DELETE CASCADE`. Reserva é consequência direta da proposta aceita.
### 3) Vínculos FK corretos?
**SIM.** Todos presentes e corretos:
- `property_proposals`: client_id → contacts, unit_id → real_estate_units, organization_id → organizations, price_list_id → real_estate_price_lists (opcional, criado condicionalmente)
- `property_reservations`: proposal_id → property_proposals, unit_id → real_estate_units, organization_id → organizations
### 4) Modelo suporta fluxo CV CRM (imóvel→tabela→proposta→condições→reserva→cliente)?
**SIM.** Cadeia completa preservada:
```
real_estate_units (imóvel)
↓ via price_list_id
real_estate_price_lists (tabela vigente)
↓ via proposal
property_proposals (proposta + payment_composition jsonb)
↓ via reservation
property_reservations (reserva vinculada à proposta)
↓ via client_id
contacts (cliente)
```
## Observações
- **Constraint de unicidade parcial:** linha 101-103 garante uma única reserva ativa por unidade (`WHERE status = 'active'`). Correto.
- **RLS:** políticas de isolamento por tenant aplicadas em ambas tabelas. Correto.
- **Status válidos:** proposals tem `draft/sent/accepted/rejected/expired`; reservations tem `active/cancelled/expired/converted`. Cobrem ciclo completo.
- **payment_composition como jsonb:** flexível o suficiente para capturar composição do CV CRM (cartão, financiamento, subsídios, parcelas).
## Status
- [x] Revisão documentada
- [x] Veredito: APROVADO
- [ ] Migração aplicada ao banco (próximo passo operacional)
---
**Evidência:** Leitura da migration `20260922215820_0383_property_proposals_reservations.sql`, linhas 1-135.
**Data:** 2026-09-23
**Nenhuma alteração na migration.** Apenas revisão.