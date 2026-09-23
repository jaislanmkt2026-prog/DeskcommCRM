# MISSÃO 8F.0 — DECISÕES ARQUITETURAIS P0 (Fluxo CV CRM)

## 1) property_proposals: entidade própria ou campo em negotiations?

**Decisão:** Entidade própria (`property_proposals`).

**Justificativa:** O fluxo CV CRM (imóvel→tabela→proposta→condições→reserva→cliente) mostra que a proposta carrega composição de pagamento rica (cartão, financiamento, subsídios, parcelas) e vínculo com tabela vigente. Um campo em `negotiations` (que sequer existe hoje) achatariam essa complexidade e perderiam o histórico de múltiplas propostas por unidade/cliente. Entidade própria permite rastrear recusas, contrapropostas e aceitação formal.

## 2) property_reservations: entidade própria ou status em unit?

**Decisão:** Entidade própria (`property_reservations`).

**Justificativa:** Reserva no CV CRM não é apenas um estado da unidade ("reservado"), mas um contrato temporário vinculado à proposta aceita, com prazo de expiração, sinal/entrada e documentos. Se fosse apenas status em `units`, perderíamos: (a) qual proposta gerou a reserva, (b) quando expira o prazo, (c) valor do sinal, (d) documentos anexos. Entidade própria permite cancelamento sem perder o histórico da negociação original.

## 3) Reserva pertence à unidade ou à negociação?

**Decisão:** Reserva pertence à **negociação** (proposta aceita), com referência derivada à unidade.

**Justificativa:** Fluxo CV CRM: `proposta → condições → reserva`. A reserva é consequência direta da aceitação de uma proposta específica. Embora ela "segure" uma unidade, o vínculo primário é com a proposta que definiu preço e condições. Isso permite auditoria: se a reserva for cancelada, a unidade volta ao pool, mas o histórico da proposta/reserva permanece intacto para análise de conversão.

## 4) Proposta pertence ao cliente ou à unidade?

**Decisão:** Proposta pertence ao **cliente**, vinculada a uma unidade específica.

**Justificativa:** Fluxo CV CRM termina em `→ cliente`. Uma proposta é uma oferta feita por um cliente específico para uma unidade específica. O mesmo cliente pode fazer propostas para múltiplas unidades (e ter múltiplas propostas recusadas antes de aceitar uma). Vincular proposta ao cliente (via `customer_id`) permite: (a) histórico de negociações do cliente, (b) score de seriedade, (c) evitar propostas conflitantes. A unidade é o objeto da proposta, não o sujeito.

---

## Modelo Relacional Resultante

```
contacts (clientes)
 ↓ 1:N
property_proposals (pertence a contact + property)
 ↓ 1:1
property_reservations (pertence a proposal, referencia property)
 ↓ deriva
units/properties (status atualizado para "reservado" enquanto reserva ativa)
```

**Chave de rastreabilidade:** `property_proposals.price_table_id` preserva qual tabela de preços estava vigente na data da proposta, atendendo ao requisito de auditoria temporal do CV CRM.

---

**Evidência:** Decisões baseadas no fluxo real observado no CV CRM Engenharq (Missão 8D.2): imóvel→tabela→proposta→condições→reserva→cliente.
**Data:** 2026-09-23
**Status:** Decisões arquiteturais documentadas, nenhum código alterado.