# REAVALIAÇÃO ARQUITETURAL — PROCESSO COMERCIAL REAL (Caixa Econômica)

## Fluxo Real Identificado
```
Lead → Qualificação → Coleta documentação → Análise crédito Caixa → Aprovação → Reunião presencial → Plano de negócio personalizado → Escolha unidade → Reserva → Contrato
```

## Novos Conceitos Críticos
1. **ANÁLISE DE CRÉDITO** = aprovação financeira antes da venda (etapa externa, dependente da Caixa)
2. **PLANO DE NEGÓCIO** = construção presencial da condição (entrada, financiamento, parcelas, subsídios) — não é simulação automática
3. **PROPOSTA** = proposta comercial baseada no plano de negócio, NÃO simulação automática
4. **RESERVA** = somente após cliente aprovado + plano apresentado + unidade escolhida

---

## Respostas às 4 Perguntas

### (a) O modelo atual suporta o fluxo real?
**NÃO.** O modelo atual (migrations 0383/0384) modela apenas `cliente → proposta → reserva`, assumindo que a proposta é uma oferta direta do cliente para uma unidade. Falta representar:
- Etapa de **análise de crédito** (dependência externa da Caixa)
- Etapa de **plano de negócio** (construção presencial de condições)
- Dependência temporal: reserva só pode ocorrer **após** aprovação de crédito e plano definido

### (b) Quais entidades/campos faltam?

**Entidades faltantes:**

1. **`credit_analyses`** — análise de crédito junto à Caixa
   - `id uuid PK`
   - `organization_id uuid FK → organizations`
   - `client_id uuid FK → contacts`
   - `status text CHECK (status IN ('pending', 'approved', 'rejected'))`
   - `approved_amount_cents bigint` (valor máximo aprovado pela Caixa)
   - `financing_type text` (SFH, SFI, etc.)
   - `caixa_reference text` (número do protocolo na Caixa)
   - `analyzed_at timestamptz`
   - `expires_at timestamptz` (validade da aprovação)
   - `documents jsonb` (comprovantes, documentos enviados à Caixa)

2. **`business_plans`** — plano de negócio construído presencialmente
   - `id uuid PK`
   - `organization_id uuid FK → organizations`
   - `client_id uuid FK → contacts`
   - `credit_analysis_id uuid FK → credit_analyses` (vincula ao crédito aprovado)
   - `entry_amount_cents bigint` (valor de entrada negociado)
   - `financing_amount_cents bigint` (valor do financiamento)
   - `subsidy_amount_cents bigint` (subsídios aplicados)
   - `installments_count integer` (número de parcelas)
   - `installment_amount_cents bigint` (valor da parcela)
   - `created_at timestamptz`
   - `created_by uuid FK → auth.users` (corretor que construiu o plano)

**Campos faltantes nas tabelas existentes:**
- `property_proposals.business_plan_id uuid FK → business_plans(id)` (proposta deve derivar do plano)
- `property_reservations.credit_analysis_id uuid FK → credit_analyses(id)` (reserva exige crédito aprovado)

### (c) Proposta deve ter vínculo com plano de negócio?
**SIM.** A proposta comercial é **derivada** do plano de negócio construído presencialmente. Sem esse vínculo, a proposta perde rastreabilidade da origem das condições negociadas (entrada, financiamento, subsídios).

### (d) Reserva deve exigir aprovação de crédito prévia?
**SIM.** Reserva só deve ser criada se existir `credit_analysis` com `status = 'approved'` para o mesmo cliente. Isso garante que o cliente tem capacidade financeira comprovada antes de "segurar" a unidade.

---

## Modelo Arquitetural Corrigido (Proposto)

```
contacts (clientes)
↓ 1:N
credit_analyses (análise de crédito Caixa)
↓ 1:1 (opcional)
business_plans (plano de negócio presencial)
↓ 1:N
property_proposals (proposta comercial derivada do plano)
↓ 1:1
property_reservations (reserva vinculada à proposta E ao crédito aprovado)
↓ deriva
real_estate_units (status atualizado para "reservado")
```

**Constraints adicionais necessárias:**
- `property_reservations` deve ter CHECK garantindo que `credit_analysis.status = 'approved'` no momento da inserção (via trigger ou função)
- `property_proposals.business_plan_id` NOT NULL quando o plano existe

---

## Impacto nas Migrations Existentes (0383/0384)
- **0383:** precisa adicionar FKs `business_plan_id` em `property_proposals` e `credit_analysis_id` em `property_reservations`
- **0384:** triggers de histórico continuam válidas, mas precisam capturar os novos campos
- **Nova migration necessária:** criar tabelas `credit_analyses` e `business_plans`

---

## Status
- [x] Reavaliação documentada
- [ ] Modelo corrigido implementado (futuro)
- [ ] Migrations criadas e aplicadas (futuro)

---

**Evidência:** Contraste entre fluxo real (Caixa + plano de negócio) e modelo atual (migrations 0383/0384).
**Data:** 2026-09-23
**Não implementar ainda.** Apenas reavaliação arquitetural.