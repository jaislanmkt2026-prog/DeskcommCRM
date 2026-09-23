# MISSÃO 8E — GAP ANALYSIS: REGRAS DE NEGÓCIO

## Visão Geral
Consolidação das regras de negócio do CRM JS Imobiliário, incorporando descobertas da Missão 8D.2 sobre fluxo real de negociação observado no CV CRM Engenharq.

---

## 1. Jornada do Cliente

### Fluxo Atual (Modelado)
```
Lead → Qualificação → Atendimento → Proposta → Fechamento → Pós-venda
```

### Fluxo Real Observado (CV CRM — Missão 8D.2)
```
Empreendimento → Unidade → Tabela vigente → Condição pagamento → Proposta → Reserva → Cliente
```

### Gap Identificado
**O modelo atual não preserva o histórico de negociação intermediário.** Falta rastreabilidade entre proposta aceita e condições de pagamento que levaram à reserva.

---

## 2. Qualificação de Lead

### Regras Atuais
- Lead entra via WhatsApp (WAHA) ou formulário web
- Lia (agente IA) faz triagem inicial com RAG por tenant
- Qualificação manual por agente humano (role `agent` ou superior)
- Campos obrigatórios: nome, telefone, interesse (pipeline/stage)

### Gaps
- **Sem score de qualificação:** não há campo numérico para priorização automática
- **Sem histórico de interação:** conversas anteriores não são vinculadas ao lead após conversão
- **Sem origem rastreável:** não registra se veio de anúncio Meta Ads, indicação, orgânico

### Regras Propostas
1. Adicionar `qualification_score numeric(5,2)` em `crm_leads`
2. Vincular `conversation_id` ao lead desde o primeiro contato
3. Registrar `source_type` e `campaign_id` (para atribuição Meta Ads)

---

## 3. Atendimento Lia (Agente IA)

### Regras Atuais
- Lia acessa via RAG embeddings em `property_embeddings`
- Filtros por `organization_id` garantem isolamento de tenant
- Busca semântica em descrição, localização, características, faixa de preço

### Gaps
- **Lia não vê condições de pagamento:** só acessa preço final, não composição negociada
- **Sem contexto de proposta anterior:** Lia não sabe se cliente já fez proposta recusada
- **Sem acesso a tabela vigente:** Lia não sabe qual tabela de preços estava ativa na época da negociação

### Regras Propostas
1. Indexar também `property_proposals` no RAG (composição de pagamento)
2. Vincular `proposal_history` ao contexto de conversa do cliente
3. Expor `active_price_table_id` nas queries de busca semântica

---

## 4. Proposta

### Estado Atual
**Tabela inexistente no schema atual.** Proposta é tratada como texto livre em `crm_lead_activities.note`.

### Gap Crítico (Missão 8D.2)
CV CRM modela proposta como entidade rica com:
- Valor total negociado
- Composição detalhada (cartão, financiamento, subsídio, descontos, parcelas)
- Vínculo com unidade específica e tabela vigente

### Regras Propostas
Criar tabela `property_proposals`:
```sql
create table property_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  customer_id uuid not null references contacts(id) on delete cascade,
  price_table_id uuid references property_price_tables(id),
  total_amount_cents integer not null,
  payment_composition jsonb not null, -- {credit_card_installments, financing, keys_discount, program_discount, subsidy, monthly_installments}
  status text check (status in ('pending', 'accepted', 'rejected', 'countered')),
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

-- RLS policy
create policy tenant_isolation_property_proposals_all
  on property_proposals for all
  using (organization_id = fn_user_org_ids());
```

---

## 5. Reserva

### Estado Atual
**Tabela inexistente.** Reserva é inferida por mudança de stage em `crm_leads` (stage = "reservado").

### Gap Crítico (Missão 8D.2)
CV CRM modela reserva como entidade vinculada à proposta aceita, com:
- Data/hora da reserva
- Valor de sinal/entrada
- Prazo para assinatura do contrato
- Documentos anexos

### Regras Propostas
Criar tabela `property_reservations`:
```sql
create table property_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  proposal_id uuid not null unique references property_proposals(id) on delete cascade,
  property_id uuid not null references properties(id) on delete cascade,
  customer_id uuid not null references contacts(id) on delete cascade,
  signal_amount_cents integer not null default 0,
  contract_deadline timestamptz,
  documents jsonb, -- [{type, url, uploaded_at}]
  status text check (status in ('active', 'cancelled', 'converted_to_sale')),
  reserved_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

-- RLS policy
create policy tenant_isolation_property_reservations_all
  on property_reservations for all
  using (organization_id = fn_user_org_ids());
```

---

## 6. Pós-Venda

### Regras Atuais
- Após won, lead é convertido em `customer` implícito (não há tabela separada)
- Atividades pós-venda registradas em `crm_lead_activities`
- Sem pipeline dedicado para entrega de chaves, documentação, satisfação

### Gaps
- **Sem pipeline pós-venda:** não há stages dedicados para documentação, vistoria, entrega
- **Sem NPS:** não há coleta de satisfação pós-entrega
- **Sem alerta de divergência:** não compara preço vendido vs. preço na proposta/reserva

### Regras Propostas
1. Criar pipeline tipo `post_sale` com stages: documentação → vistoria → entrega → NPS
2. Adicionar trigger: ao mover lead para "won", criar automaticamente entrada em pipeline pós-venda
3. Alerta automático se `property_reservations.total_amount_cents ≠ property_sales.final_amount_cents`

---

## 7. Tabela de Preços Vigente

### Estado Atual
Tabela `property_prices` existe, mas sem vínculo temporal explícito com período de vigência.

### Gap (Missão 8D.2)
CV CRM associa cada negociação a uma `tabela_vigente` específica, permitindo auditoria de qual preço foi ofertado na data da proposta.

### Regras Propostas
Criar tabela `property_price_tables`:
```sql
create table property_price_tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null, -- ex: "Tabela Q3-2026"
  effective_from date not null,
  effective_until date,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Alterar property_prices para vincular à tabela
alter table property_prices add column price_table_id uuid references property_price_tables(id);
```

---

## Resumo dos Gaps Críticos

| Área | Gap | Impacto | Prioridade |
|------|-----|---------|------------|
| Proposta | Tabela inexistente | Perda de histórico de negociação | **Alta** |
| Reserva | Tabela inexistente | Sem rastreabilidade proposta→cliente | **Alta** |
| Tabela de preços | Sem vigência temporal | Impossível auditar preço ofertado na data | **Alta** |
| Qualificação | Sem score/origem | Lead não priorizado, sem atribuição de campanha | Média |
| Lia (IA) | Sem acesso a composição de pagamento | Agente não entende contexto de negociação | Média |
| Pós-venda | Sem pipeline dedicado | Entrega/documentação não rastreada | Média |

---

## Próximos Passos (Não Implementados)

1. [ ] Criar migration para `property_proposals`, `property_reservations`, `property_price_tables`
2. [ ] Alterar `property_prices` para adicionar `price_table_id`
3. [ ] Adaptar script de importação Engenharq para popular novas tabelas
4. [ ] Atualizar RAG da Lia para indexar propostas e composições de pagamento
5. [ ] Criar pipeline pós-venda com stages dedicados
6. [ ] Implementar alerta de divergência de preço

---

**Evidência:** Análise baseada em observação direta do CV CRM Engenharq (Missão 8D.2) e revisão do schema atual do DeskcommCRM.
**Data:** 2026-09-23
**Status:** Documentação concluída, nenhum código alterado.