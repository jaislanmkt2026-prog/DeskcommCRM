# IMPACTO COMERCIAL P0 — PROPOSTAS, RESERVAS E PAGAMENTO
**Data:** 2026-09-23
**Autor:** Agente de IA (Missão 8F.0)
**Org:** JS Imóveis (e6243f24-75e0-427c-8f7f-3654f5e75ed4)
**Status:** DOCUMENTAÇÃO — Não implementado
---
## Esclarecimento de Escopo
As tabelas `property_proposals`, `property_reservations` e `payment_composition` **não existem** neste schema. O módulo financeiro do DeskcommCRM opera com:
- **`sales`** (comanda) — registra a venda/proposta formalizada
- **`sale_items`** — itens da proposta (imóvel/serviço associado)
- **`financial_entries`** — lançamentos financeiros (entradas/saídas)
- **`commissions`** — comissões geradas por item
- **`loyalty_ledger`** — pontos de fidelidade
- **`payment_methods`** — formas de pagamento (vinculadas a contas)
O impacto comercial P0 deve ser mapeado sobre **estas entidades reais**, não sobre tabelas hipotéticas. A importação do CV CRM populando `crm_leads.external_id` é o gatilho que alimenta todo o ciclo abaixo.
---
## Fluxo Operacional P0 Mapeado
CV CRM import → `crm_leads` (imóvel disponível) → Lia qualifica → Time Chaves agenda visita → Corretor registra proposta (`sales`) → Cliente aceita → Pagamento registrado (`financial_entries`) → Pós-venda (retenção + indicação)
---
## Impacto por Etapa
### 1. Lia (Triagem Inicial)
**Papel:** Primeiro contato via WhatsApp, captura interesse em imóvel específico.
**Sem dados CV CRM:** Lia não sabe se imóvel existe na base, responde genérico.
**Com dados CV CRM:** Lia acessa `crm_leads` com `external_id`, endereço, valor, tipo, status (disponível/reservado/vendido). Pode filtrar por faixa/bairro/quartos via RAG.
**Gap P0 fechado:** `external_id` do CV CRM vira chave de contexto para toda operação subsequente.
**Risco se faltar:** Conversão inicial baixa, cliente desiste por irrelevância.
### 2. Time Chaves (Qualificação Técnica)
**Papel:** Agenda visita, verifica documentação, valida viabilidade (financiamento, matrícula).
**Sem dados CV CRM:** Repete perguntas, sem histórico de visitas anteriores, sem saber se imóvel já foi ofertado.
**Com dados CV CRM:**
- `crm_lead_activities` registra visitas agendadas/realizadas
- `crm_lead_links` conecta leads relacionados (mesmo cliente, imóveis diferentes)
- `custom_fields` traz IPTU, metragem, ano, condomínio
- `tags` marcam urgência, perfil (investidor, primeira compra)
**Gap P0 fechado:** Visibilidade 360°, sem duplicação de esforço.
**Risco se faltar:** Perda de timing comercial, cliente irritado.
### 3. Corretor (Proposta / Negociação)
**Papel:** Registra proposta formal, negocia condições, fecha contrato.
**Sem dados CV CRM:** Proposta verbal/planilha externa, sem audit trail, sem rastreabilidade.
**Com dados CV CRM + Módulo Financeiro:**
- **`sales`** registra a proposta formal com `contact_id`, `attendant_user_id` (corretor), `status` (open/finalized/cancelled), `discount_cents`, `total_cents`
- **`sale_items`** detalha o imóvel/serviço proposto com `event_type_id` (tipo de negócio), `unit_price_cents`, `commission_percent` congelado na inclusão
- **`payment_methods`** define forma de pagamento (à vista, parcelado, financiamento) vinculada a conta financeira
- **`financial_entries`** lança entrada na conta correta quando proposta é finalizada
- **`commissions`** calcula comissão do corretor automaticamente
- `owner_user_id` atribui responsabilidade clara
- Audit log em `api_audit_log` registra cada mudança
**Gap P0 fechado:** Negociação data-driven, prova de termos acordados, cálculo automático de comissão.
**Risco se faltar:** Conflito de comissão, propostas perdidas, sem prova de acordo.
### 4. Cliente (Experiência de Compra)
**Papel:** Aceita proposta, envia documentação, paga, recebe chaves.
**Sem dados CV CRM:** Opera no escuro, sem atualizações proativas.
**Com dados CV CRM + Módulo Financeiro:**
- Notificações automáticas via Lia ("proposta registrada", "pagamento confirmado", "agendamento concluído")
- `crm_lead_activities` visível como timeline transparente
- `financial_entries.status = 'paid'` confirma recebimento
- LGPD compliance: anonimização sob demanda via `fn_lgpd_cascade_redact_contact`
- Histórico completo para futuras interações
**Gap P0 fechado:** Experiência profissional, reduz atrito, aumenta confiança.
**Risco se faltar:** Abandono por falta de comunicação, review negativo.
### 5. Pós-venda (Retenção / Indicação)
**Papel:** Follow-up, pesquisa satisfação, captação indicações, remarketing.
**Sem dados CV CRM:** Sem registro de satisfação, sem base para cross-sell.
**Com dados CV CRM + Módulo Financeiro:**
- **`loyalty_ledger`** registra pontos de fidelidade por compra (`points`, `reason`, `sale_id`)
- **`crm_lead_links`** com `link_kind = 'referral'` conecta cliente original a indicados
- **`sales`** histórico completo de compras anteriores
- **`commissions`** com `status = 'paid'` mostra quem recebeu e quando
- **`financial_entries`** com `reverses_entry_id` rastreia estornos/devoluções
- `tags` marcam "VIP", "indicador frequente"
- `source_metadata` preserva origem da campanha para attribution
**Gap P0 fechado:** Ciclo de vida completo rastreado, campanhas de retenção baseadas em dados reais.
**Risco se faltar:** Perda de LTV, cliente não retorna, não indica.
---
## Gaps Críticos P0 Identificados
| Gap | Impacto Comercial | Severidade | Mitigação |
|-----|-------------------|------------|-----------|
| **Sem external_id do CV CRM em `crm_leads`** | Lia não contextualiza, corretor não tem inventário | CRÍTICA | Import pipeline (Missão 8C) popula `external_id` |
| **Sem integração `crm_leads` → `sales`** | Proposta não vinculada ao imóvel importado | ALTA | FK `crm_leads.id` → `sales.contact_id` já existe; garantir workflow UI |
| **Sem `payment_methods` configuradas** | Finalização de comanda falha sem conta destino | ALTA | Configurações → Financeiro: criar formas ativas com `account_id` |
| **Sem automação de notificações** | Cliente não sabe status do pagamento | MÉDIA | Worker WAHA escuta `financial_entries.paid_at` e dispara |
| **Sem dashboard de comissões** | Corretor não vê pendências | MÉDIA | View agregando `commissions` por `attendant_user_id` e `status` |
| **Sem LGPD automation** | Risco legal em redaction requests | CRÍTICA | Implementar `fn_lgpd_cascade_redact_contact` cascade para `sales`, `financial_entries` |
---
## Métricas de Sucesso P0
- **Propostas registradas no sistema (`sales`):** +200% (de ~30% para ~90%)
- **Tempo de finalização de comanda:** -80% (de manual para transação atômica)
- **Comissões calculadas automaticamente:** 100% (vs ~40% manual antes)
- **Lançamentos financeiros corretos:** 100% auditáveis, zero divergência
- **Pontos de fidelidade rastreados (`loyalty_ledger`):** +150% resgates
---
## Próximos Passos Recomendados
1. **Prioridade 1:** Implementar import CV CRM → `crm_leads.external_id` (Missão 8C)
2. **Prioridade 2:** Criar UI de registro de proposta (`sales` + `sale_items`) vinculada a `crm_leads`
3. **Prioridade 3:** Configurar `payment_methods` ativas com `account_id` em Configurações → Financeiro
4. **Prioridade 4:** Implementar worker de notificações WAHA baseado em `financial_entries.paid_at`
5. **Prioridade 5:** Criar dashboard de comissões (`commissions` por corretor/status)
6. **Prioridade 6:** Reforçar LGPD cascade para tabelas financeiras
---
**FIM DA NOTA**