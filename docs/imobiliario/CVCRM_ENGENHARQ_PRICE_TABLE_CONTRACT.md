# Contrato da Tabela Oficial de Preço — Engenharq

**Empreendimento:** Jardim das Laranjeiras (CV CRM ID 14)
**Construtora:** Engenharq
**Org alvo:** JS Imóveis (`e6243f24-75e0-427c-8f7f-3654f5e75ed4`)
**Fonte:** PDF oficial da tabela de preços (formato não acessível diretamente; campos derivados da especificação da Missão 8C)

---

## Mapeamento Campo-a-Campo

| campo_origem | tipo | obrigatorio | normalizacao | destino_proposto | regra_de_validacao |
|---|---|---|---|---|---|
| nome_do_empreendimento | text | sim | Trim, title case | `real_estate_developments.nome` (lookup) | Deve corresponder a empreendimento existente na org |
| tabela_vigencia | text | sim | ISO-8601 date range (ex. "2026-09") | `real_estate_price_lists.vigencia_inicio` + `vigencia_fim` | Vigência deve ser válida (inicio <= fim) |
| etapa | text | nao | Trim, uppercase | `real_estate_price_lists.etapa` | Livre, mas consistente dentro do empreendimento |
| quadra | text | nao | Trim, uppercase | `real_estate_units.quadra` | Deve existir no empreendimento |
| unidade_lote | text | sim | Trim, uppercase alfanumérico | `real_estate_units.numero` | Único por `(development_id, bloco, numero)` |
| area_privativa | numeric | sim | Decimal (m², 2 casas) | `real_estate_units.metragem` | Deve ser > 0 |
| situacao | enum | sim | Lowercase, trim | `real_estate_units.status` | Deve ser um de: `disponivel`, `reservado`, `vendido`, `bloqueado` |
| sinal_pix | bigint | nao | Inteiro centavos | `real_estate_price_list_items.sinal_cents` | Se presente, >= 0 e <= valor_total |
| parcelas_mensais | jsonb | nao | Array de {parcela, valor_cents, vencimento} | `real_estate_price_list_items.parcelas` | Soma dos valores deve bater com complemento do valor_total |
| chaves | text | nao | Trim | `real_estate_price_list_items.condicoes_chaves` | Livre (ex. "na entrega", "imediato") |
| financiamento | text | nao | Trim, lowercase | `real_estate_price_list_items.financiamento` | Deve ser um de: `a_vista`, `financiado`, `consorcio`, ou descrição livre |
| valor_total | bigint | sim | Inteiro centavos | `real_estate_units.valor_cents` | Deve ser > 0 |

---

## Regras de Negócio

1. **Dedupe de unidade:** chave única `(development_id, bloco, numero)`. Se já existir, atualiza preço/condições e grava histórico em `real_estate_history`.
2. **Preço inválido:** `valor_total <= 0` → **rejeita** toda a linha.
3. **Sinal inconsistente:** `sinal_pix > valor_total` → **rejeita**.
4. **Parcelas inconsistentes:** soma de `parcelas_mensais[*].valor_cents` + `sinal_pix` != `valor_total` → **alerta**, mas aceita (pode haver entrada não documentada).
5. **Empreendimento inexistente:** se `nome_do_empreendimento` não achar em `real_estate_developments` para a org → **rejeita**.
6. **Situação inválida:** valor fora do check constraint → **rejeita**.
7. **Histórico de preço:** se `valor_total` mudou, grava em `real_estate_history` com `campo='valor_cents'`.
8. **Histórico de condições:** se `sinal_pix`, `parcelas` ou `financiamento` mudaram, grava em `real_estate_history` com `campo='condicoes_pagamento'`.
9. **Transação:** tudo em uma única transação por lote; falha em qualquer linha → rollback total.
10. **Idempotência:** importar o mesmo arquivo 2x não duplica linhas; apenas atualiza se houver mudança.

---

## Formato Esperado (JSON)

```json
[
 {
 "nome_do_empreendimento": "Jardim das Laranjeiras",
 "tabela_vigencia": "2026-09",
 "etapa": "ETAPA 1",
 "quadra": "Q1",
 "unidade_lote": "101A",
 "area_privativa": 65.5,
 "situacao": "disponivel",
 "sinal_pix": 500000,
 "parcelas_mensais": [
 {"parcela": 1, "valor_cents": 100000, "vencimento": "2026-10-10"},
 {"parcela": 2, "valor_cents": 100000, "vencimento": "2026-11-10"},
 {"parcela": 3, "valor_cents": 100000, "vencimento": "2026-12-10"}
 ],
 "chaves": "na entrega",
 "financiamento": "financiado",
 "valor_total": 25000000
 }
]
```

---

## Campos Não Comprovados

Os seguintes campos foram inferidos da especificação da Missão 8C, mas seu formato exato no PDF oficial **não foi verificado**:

- `tabela_vigencia`: pode ser texto livre ("Set/2026") em vez de ISO-8601
- `etapa`: pode não existir no PDF, ser implícito
- `quadra`: pode ser parte do identificador da unidade
- `parcelas_mensais`: estrutura exata (número de parcelas, carência) desconhecida
- `chaves`: pode ser texto livre ou código
- `financiamento`: pode ser descrição longa em vez de enum

**Recomendação:** acessar o PDF original ou uma amostra real para validar esses formatos antes de implementar o parser.