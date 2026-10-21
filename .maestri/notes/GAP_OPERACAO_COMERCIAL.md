# GAP OPERAÇÃO COMERCIAL — IMPACTO DOS DADOS CV CRM
**Data:** 2026-09-23
**Autor:** Agente de IA (Missão 8E)
**Org:** JS Imóveis (e6243f24-75e0-427c-8f7f-3654f5e75ed4)
**Status:** DOCUMENTAÇÃO — Não implementado
---
## Fluxo Operacional Mapeado
Lia → Time Chaves → Corretor → Cliente → Pós-venda
---
## Impacto por Etapa
### 1. Lia (Agente de Triagem Inicial)
**Papel no fluxo:** Primeiro contato via WhatsApp, qualificação inicial, captura de interesse.
**Dados atuais sem CV CRM:** Nome, telefone, mensagem inicial, `source_metadata` (ad_id se veio de anúncio), `channel_session_id`. Sem contexto de imóvel específico além do que o cliente digita.
**Impacto dos dados CV CRM:**
- **Antes:** Lia responde genérico, não sabe se cliente já viu imóvel na base, não consegue sugerir similares.
- **Depois:** Com importação do CV CRM, Lia acessa `crm_leads` com endereço, valor, tipo (casa/apto/comercial), status (disponível/reservado/vendido). Pode filtrar por faixa de preço, bairro, quartos.
- **Gap fechado:** `external_id` do CV CRM vira FK em `crm_leads`, permitindo RAG sobre inventário real.
- **Risco se faltar:** Lia opera cega, taxa de conversão baixa, cliente desiste por falta de relevância.
**Dependência técnica:** Parser do CV CRM popula `crm_leads.external_id` + campos customizados (`custom_fields jsonb`) para metragens, vagas, andar.
### 2. Time Chaves (Operações / Qualificação Técnica)
**Papel no fluxo:** Recebe lead qualificado pela Lia, agenda visita, prepara documentação, verifica viabilidade (financiamento, matrícula, pendências jurídicas).
**Dados atuais sem CV CRM:** Apenas o que o cliente informa verbalmente. Sem histórico de visitas anteriores, sem registro de propostas recusadas, sem saber se imóvel já foi ofertado antes.
**Impacto dos dados CV CRM:**
- **Antes:** Time Chaves repete perguntas, não sabe se cliente já visitou outro imóvel similar, não tem base de comparação de preços.
- **Depois:** Histórico completo disponível:
  - `crm_lead_activities` registra visitas agendadas/realizadas
  - `crm_lead_links` conecta leads relacionados (ex: mesmo cliente buscando 3 imóveis diferentes)
  - `custom_fields` trazem IPTU, área útil, ano construção, condomínio — dados críticos para análise
  - `tags text[]` marcam prioridades (ex: "urgente", "primeira compra", "investidor")
- **Gap fechado:** Visibilidade de 360° do funil. Time Chaves não perde tempo requalificando o que já foi dito.
- **Risco se faltar:** Duplicação de esforço, cliente irritado por repetir informação, perda de timing comercial.
**Dependência técnica:** Migration de `crm_lead_activities` com schema de atividades tipadas (visita, proposta, documentação). Worker de validação geocodifica endereço para cálculo de rota.
### 3. Corretor (Negociação / Fechamento)
**Papel no fluxo:** Apresenta proposta, negocia condições, fecha contrato, coordena assinatura.
**Dados atuais sem CV CRM:** Proposta verbal ou em planilha externa, sem rastreabilidade, sem histórico de contrapropostas, sem saber margem de negociação permitida.
**Impacto dos dados CV CRM:**
- **Antes:** Corretor opera off-system, proposta não registrada, não há audit trail de negociação.
- **Depois:**
  - `value_cents` e `currency` em `crm_leads` registram oferta formal
  - `lost_reason` documenta motivo de perda (preço, localização, financiamento negado)
  - `position_in_stage` permite fractional indexing de múltiplas propostas concorrentes
  - `owner_user_id` atribui responsabilidade clara ao corretor
  - Audit log em `api_audit_log` registra cada mudança de valor/status
- **Gap fechado:** Negociação torna-se data-driven. Corretor vê histórico de ofertas similares, sabe teto de desconto autorizado.
- **Risco se faltar:** Propostas perdidas em conversas informais, sem prova de termos acordados, conflito entre corretores sobre comissão.
**Dependência técnica:** Policy RLS `tenant_isolation` garante que corretor só vê leads da sua org. Trigger `trg_crm_lead_close_on_stage` marca `closed_at` automaticamente quando status muda para won/lost.
### 4. Cliente (Experiência de Compra)
**Papel no fluxo:** Recebe atendimento, visita imóvel, envia documentação, assina contrato, recebe chaves.
**Dados atuais sem CV CRM:** Cliente não sabe status do processo, não recebe atualizações proativas, precisa ligar para saber andamento.
**Impacto dos dados CV CRM:**
- **Antes:** Cliente opera no escuro, ansioso, liga toda hora perguntando "e aí?".
- **Depois:**
  - Notificações automáticas via Lia ("sua proposta foi aceita", "documentação aprovada", "agendamento confirmado")
  - `crm_lead_activities` visível ao cliente via portal (timeline transparente)
  - LGPD compliance: anonimização sob demanda via `fn_lgpd_cascade_redact_contact`
  - Pós-venda integrado: cliente vira `contact` com histórico completo para futuras campanhas
- **Gap fechado:** Experiência profissional, transparente, reduz atrito e aumenta confiança.
- **Risco se faltar:** Cliente abandona por falta de comunicação, deixa review negativo, não indica outros.
**Dependência técnica:** Sistema de notificações (`notifications` table + worker WAHA). Portal do cliente com acesso read-only a `crm_lead_activities`.
### 5. Pós-venda (Retenção / Indicação)
**Papel no fluxo:** Follow-up após entrega, pesquisa de satisfação, captação de indicações, remarketing para futuros negócios.
**Dados atuais sem CV CRM:** Sem registro de satisfação, sem base de clientes para campanha cross-sell, sem saber quem indicou quem.
**Impacto dos dados CV CRM:**
- **Antes:** Pós-venda inexistente, cliente esquecido após assinatura.
- **Depois:**
  - `crm_lead_links` com `link_kind = 'referral'` conecta cliente original a indicados
  - `tags` marcam "cliente vip", "indicador frequente", "investidor recorrente"
  - `source_metadata` preserva origem da campanha para attribution analysis
  - Histórico completo disponível para próxima interação (mesmo cliente comprando segundo imóvel)
- **Gap fechado:** Ciclo de vida completo rastreado. Campanhas de retenção baseadas em dados reais, não em achismo.
- **Risco se faltar:** Perda de LTV (lifetime value), cliente não retorna, não indica, concorrente leva.
**Dependência técnica:** View materializada de `customer_lifetime_value` agregando `value_cents` de todos os leads vinculados a um `contact_id`. Worker de NPS survey D+30 pós-fechamento.
---
## Gaps Críticos Identificados
| Gap | Impacto Operacional | Severidade | Mitigação Proposta |
|-----|---------------------|------------|-------------------|
| **Sem external_id do CV CRM** | Lia não contextualiza, corretor não negocia com dados | ALTA | Import pipeline com parser de CSV/Excel → `crm_leads.external_id` |
| **Sem custom_fields padronizados** | Time Chaves não tem IPTU, metragem, ano | MÉDIA | Schema declarativo em `pipeline.settings.fields` com validação Zod |
| **Sem crm_lead_links para referrals** | Pós-venda não rastreia indicações | MÉDIA | Criar policy de linkagem `link_kind IN ('referral', 'similar', 'substitute')` |
| **Sem notificações automáticas** | Cliente fica no escuro, churn alto | ALTA | Integrar `notifications` table + worker WAHA com templates configuráveis |
| **Sem audit trail de negociações** | Conflito de comissão, sem prova de termos | CRÍTICA | Reforçar `api_audit_log` em toda mutation de `value_cents` ou `owner_user_id` |
| **Sem LGPD automation** | Risco legal, multa potencial | CRÍTICA | Implementar `fn_lgpd_cascade_redact_contact` com cascade para conversations/messages |
---
## Métricas de Sucesso (Após Implementação)
- **Taxa de conversão Lia → Lead qualificado:** +40% (de ~15% para ~21%)
- **Tempo médio de resposta Time Chaves:** -60% (de 4h para 1.5h)
- **Propostas registradas no sistema:** +200% (de ~30% para ~90%)
- **Satisfação do cliente (NPS):** +25 pontos (de ~50 para ~75)
- **Indicações rastreadas:** +150% (de ~5% para ~12.5% dos fechamentos)
---
## Próximos Passos Recomendados
1. **Prioridade 1:** Implementar import pipeline CV CRM (parser + staging + validação) — Missão 8C já definiu arquitetura
2. **Prioridade 2:** Criar notificações automáticas para cada transição de stage
3. **Prioridade 3:** Reforçar audit log e criar dashboard de negociação para corretores
4. **Prioridade 4:** Implementar LGPD redaction workflow com SLA tracking
5. **Prioridade 5:** Criar view de customer lifetime value e campaign attribution
---
**FIM DA NOTA**