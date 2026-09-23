# MISSÃO 8D.2 — DESCOBERTA ARQUITETURAL: FLUXO DE NEGOCIAÇÃO CV CRM

## Evidência Observada (CV CRM Engenharq)

Fluxo real de negociação capturado no sistema legado:

```
Empreendimento → Unidade → Tabela vigente → Condição pagamento → Proposta → Reserva → Cliente
```

### Exemplo Concreto
- **Empreendimento:** Jardim Jacarandá
- **Unidade:** H-03
- **Valor total:** R$ 10.300,00
- **Composição do pagamento:**
  - Cartão de crédito: 10x
  - Financiamento: R$ 7.992,00
  - Chaves: R$ 0,00
  - Desconto programa: R$ 0,00
  - Subsídio: R$ 0,00
  - Parcelas mensais: 100x R$ 0,00

## Conclusão Arquitetural

**CRM JS NÃO deve modelar apenas `imóvel → preço`.**

Modelagem correta requer preservação do histórico completo de negociação:

```
imóvel → tabela_vigente → proposta → condições_pagamento → reserva → cliente
```

### Implicações para Schema DeskcommCRM

1. **Tabela `property_price_tables`** — registra qual tabela de preços estava vigente em cada período
2. **Tabela `property_proposals`** — captura cada proposta com composição de pagamento detalhada
3. **Tabela `property_reservations`** — registra reserva vinculada à proposta aceita
4. **Relacionamento explícito** entre proposal ↔ reservation ↔ customer

### Por Que Isso Importa

- Preço final não é apenas o valor da tabela — é resultado de negociação complexa
- Composição de pagamento (cartão, financiamento, subsídios, descontos) deve ser rastreável
- Histórico de propostas perdidas/aceitas é dado estratégico para análise de conversão
- Agente IA (Lia) precisa entender contexto de negociação, não apenas preço atual

## Status

- [x] Descoberta documentada
- [ ] Schema implementado (futuro)
- [ ] Migração de dados CV → novo modelo (futuro)

---
**Evidência:** Observação direta do fluxo CV CRM Engenharq, Missão 8D.2.
**Data:** 2026-09-23
**Não implementar ainda.** Apenas registro de descoberta.