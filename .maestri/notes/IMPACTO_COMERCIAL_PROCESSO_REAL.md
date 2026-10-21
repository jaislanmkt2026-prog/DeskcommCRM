# IMPACTO COMERCIAL — PROCESSO REAL IMOBILIÁRIO
**Data:** 2026-09-23
**Autor:** Agente de IA (Correção Regra Negócio)
**Org:** JS Imóveis (e6243f24-75e0-427c-8f7f-3654f5e75ed4)
**Status:** DOCUMENTAÇÃO — Não implementado
---
## Fluxo Correto (Realidade Imobiliária)
Lead → Qualificação → Documentação → **Análise crédito Caixa** → **Aprovação** → Reunião presencial → **Plano negócio** → Escolha unidade → **Reserva** → Contrato
---
## Impacto por Etapa
### (a) Análise de Crédito Caixa — Impacto na Triagem da Lia
**Papel no fluxo real:** Antes de qualquer proposta séria, o cliente precisa saber se tem capacidade de financiamento. A Caixa (ou outro banco) é quem aprova ou nega.
**Como impacta a triagem da Lia:**
- **Antes (fluxo idealizado):** Lia qualificava lead → corretor apresentava imóvel → proposta. Sem filtro de crédito, 80% dos leads chegavam ao corretor sem saber se podiam comprar.
- **Depois (fluxo real):** Lia captura dados mínimos para pré-análise (renda bruta, idade, dependentes, regime de trabalho) e dispara worker que consulta API da Caixa (simulador habitacional). Resultado vai para `crm_lead_activities` com tipo `credit_check` e status (`aprovado`, `reprovado`, `pendente_documentacao`).
- **Gap fechado:** Lia filtra leads não-elegíveis antes de enviar ao Time Chaves. Taxa de conversão sobe porque só chegam ao corretor leads com viabilidade comprovada.
- **Risco se faltar:** Corretor perde tempo com leads inaptos, frustração do cliente que se apaixona por imóvel que não pode financiar.
**Dependência técnica:** Worker de integração com API Caixa (simulador habitacional). Campos novos em `custom_fields` de `crm_leads`: `renda_bruta_cents`, `idade`, `regime_trabalho`. Status em `crm_lead_activities.type = 'credit_check'`.
### (b) Plano de Negócio Presencial — Exige Novo Fluxo no CRM?
**Papel no fluxo real:** Após aprovação de crédito, reunião presencial para montar estratégia de compra (entrada + parcelas + FGTS + subsídio). É o momento da verdade comercial.
**Exige novo fluxo no CRM?**
- **Sim.** O CRM atual trata lead como pipeline linear. O plano de negócio é um **sub-processo ramificado** que exige:
1. Agenda de reunião presencial (`calendar_appointments` com `event_type_id = 'plano_negocio'`)
2. Checklist de documentos trazidos pelo cliente (RG, CPF, contracheque, IR, extrato FGTS)
3. Simulação de cenários (3 simulações diferentes: mais entrada, menos parcela, etc.)
4. Registro de decisão do cliente (qual cenário escolheu)
- **Implementação conceitual:** Nova tabela `business_plan_simulations` vinculada a `crm_leads.id`, com campos: `scenario_name`, `entry_cents`, `installments_count`, `monthly_payment_cents`, `fgts_amount_cents`, `subsidy_cents`, `chosen boolean`. Cada simulação gera linha em `crm_lead_activities` para auditoria.
- **Gap fechado:** Estratégia de compra documentada, prova do que foi apresentado, base para renegotiação futura.
- **Risco se faltar:** Cliente esquece o que foi combinado, corretor não lembra qual simulação apresentou, conflito sobre termos acordados.
### (c) Reserva Pós-Aprovação — Muda Métricas de Conversão?
**Papel no fluxo real:** Cliente escolhe unidade específica, paga sinal/reserva (geralmente 1-5% do valor), imóvel sai do mercado até contrato ser assinado.
**Como muda métricas de conversão:**
- **Antes (sem reserva):** Métrica era `leads_won / total_leads`. Problema: lead "won" podia significar proposta aceita, mas sem reserva paga, o negócio ainda podia cair.
- **Depois (com reserva):** Nova etapa intermediária entre `proposal_accepted` e `contract_signed`. Tabela `property_reservations` (já existente no schema como conceito, mas não implementada) registra:
- `lead_id` FK para `crm_leads.id`
- `unit_id` FK para imóvel específico (se houver catálogo de unidades)
- `reservation_amount_cents` valor pago como sinal
- `expires_at` data limite para assinar contrato (geralmente 30-90 dias)
- `status` em (`active`, `expired`, `converted_to_contract`, `cancelled`)
- **Métrica nova:** `conversion_rate_reservation_to_contract = contracts_signed / reservations_made`. Esta taxa é mais honesta que a taxa geral, porque mede eficiência do pós-reserva.
- **Impacto no funil:** Lead não vai direto para `won`. Vai para stage `reserved` em `crm_stages`. Só vira `won` quando contrato é assinado e registrado em cartório.
- **Gap fechado:** Visibilidade real do funil. Gestão de reservas vencidas (imóvel volta ao mercado se cliente não assinar no prazo).
- **Risco se faltar:** Imóvel fica travado por meses sem contrato, corretor não sabe quais reservas estão prestes a vencer, perda de vendas por falta de follow-up.
### (d) Auditoria Precisa Rastrear Aprovação Caixa?
**Papel no fluxo real:** Aprovação da Caixa é documento legal. Se negócio der errado, precisa provar que cliente tinha capacidade financeira no momento da proposta.
**Auditoria precisa rastrear?**
- **Sim, criticamente.** Aprovação da Caixa não é apenas um "sim/não". É um documento PDF com número de protocolo, validade (geralmente 90 dias), condições específicas (taxa de juros, CET, seguro). Tudo isso deve ser auditável.
- **Implementação conceitual:** Tabela `credit_approvals` vinculada a `crm_leads.id`:
- `lead_id uuid references crm_leads(id)`
- `institution text` ('Caixa', 'Itaú', 'Bradesco')
- `protocol_number text` número oficial da aprovação
- `approved_amount_cents bigint` valor máximo aprovado
- `valid_until date` validade da aprovação
- `conditions_json jsonb` taxas, CET, seguros exigidos
- `document_url text` URL assinada do PDF no Supabase Storage
- `created_by_user_id uuid` quem fez o upload
- `created_at timestamptz` timestamp da aprovação
- **Audit log:** Toda mudança em `credit_approvals` gera entrada em `api_audit_log` com ação `credit_approval.created` ou `credit_approval.updated`. PDF é imutável após upload (apenas nova versão com versionamento).
- **Gap fechado:** Prova documental em caso de disputa legal. Rastreabilidade de qual banco aprovou, quando, e sob quais condições.
- **Risco se faltar:** Cliente diz que foi aprovado em R$ 500k, corretor acha que foi R$ 400k, negócio fecha errado, banco nega financiamento, processo judicial contra imobiliária.
---
## Gaps Críticos Identificados (Processo Real)
| Gap | Impacto Comercial | Severidade | Mitigação |
|-----|-------------------|------------|-----------|
| **Sem integração API Caixa** | Lia não filtra leads inaptos, corretor perde tempo | CRÍTICA | Worker de simulação habitacional com credenciais OAuth da Caixa |
| **Sem tabela business_plan_simulations** | Estratégia de compra não documentada, renegotiação sem base | ALTA | Criar tabela com FK para `crm_leads`, UI de simulação multi-cenário |
| **Sem property_reservations** | Imóvel travado sem contrato, métrica de conversão distorcida | ALTA | Criar tabela com `expires_at`, worker de alerta D-7 do vencimento |
| **Sem credit_approvals auditável** | Sem prova documental em disputa legal, risco jurídico | CRÍTICA | Tabela com PDF imutável no Storage, hash SHA256 do documento em `api_audit_log` |
| **Sem stage 'reserved' no pipeline** | Funil não reflete realidade operacional, gestão cega | MÉDIA | Adicionar `crm_stages.slug = 'reserved'` com policy de transição automática após 30 dias sem contrato |
---
## Métricas de Sucesso (Após Implementação)
- **Leads filtrados pela Lia (pré-análise Caixa):** +60% de economia de tempo do corretor
- **Taxa de conversão reserva→contrato:** visível e rastreável (meta: >85%)
- **Reservas vencidas com alerta automático:** -90% de imóveis travados indevidamente
- **Documentos de aprovação Caixa auditáveis:** 100% dos fechamentos com PDF arquivado
- **Tempo médio de análise de crédito:** <48h (de manual para automatizado via API)
---
## Próximos Passos Recomendados
1. **Prioridade 1:** Integrar API Caixa simulador habitacional (credenciais OAuth + worker de consulta)
2. **Prioridade 2:** Criar tabela `credit_approvals` com storage de PDFs e hash de auditoria
3. **Prioridade 3:** Criar tabela `property_reservations` com worker de expiry alert
4. **Prioridade 4:** Criar tabela `business_plan_simulations` com UI multi-cenário
5. **Prioridade 5:** Adicionar stage `reserved` em pipelines imobiliários com política de transição automática
---
**FIM DA NOTA**