# Contrato de Importação — Engenharq

**Org alvo:** JS Imóveis (`e6243f24-75e0-427c-8f7f-3654f5e75ed4`) 
**Construtora seed:** `Engenharq` (criada automaticamente pela migration 0382)

## Mapeamento Campo-a-Campo

| Campo Engenharq (CSV/JSON) | Tipo | Destino no DeskcommCRM | Validação |
|---|---|---|---|
| `construtora` | text | `constructors.nome` | Deve existir ou ser criada como seed |
| `empreendimento` | text | `real_estate_developments.nome` | Obrigatório; deve existir antes da unidade |
| `localizacao` | text | `real_estate_developments.localizacao` | Opcional |
| `bairro` | text | `real_estate_developments.bairro` | Opcional |
| `cidade` | text | `real_estate_developments.cidade` | Opcional |
| `unidade_numero` | text | `real_estate_units.numero` | **Obrigatório**, único por `(development_id, bloco, numero)` |
| `bloco` | text | `real_estate_units.bloco` | Opcional (pode ser `NULL`) |
| `andar` | integer | `real_estate_units.andar` | Opcional |
| `metragem` | numeric | `real_estate_units.metragem` | Deve ser > 0 se presente |
| `quartos` | integer | `real_estate_units.quartos` | Opcional, >= 0 |
| `suites` | integer | `real_estate_units.suites` | Opcional, >= 0 |
| `vagas` | integer | `real_estate_units.vagas` | Opcional, >= 0 |
| `tipologia` | text | — | Descritivo da unidade; pode ir em `condicoes` ou ser ignorado |
| `preco_cents` | bigint | `real_estate_units.valor_cents` | **Obrigatório**, > 0 |
| `disponibilidade` | enum | `real_estate_units.status` | Deve ser um de: `disponivel`, `reservado`, `vendido`, `bloqueado` |
| `atualizado_em` | timestamptz | `real_estate_units.updated_at` | ISO-8601 UTC; usado para ordenar histórico |
| `origem` | text | `real_estate_history.fonte` | Rastreabilidade (ex.: "engenharq_csv_2026") |

## Regras de Negócio

1. **Dedupe de unidade:** chave única `(development_id, bloco, numero)`. Se já existir, atualiza preço/status e grava histórico.
2. **Preço inválido:** `valor_cents <= 0` → **rejeita** toda a linha.
3. **Empreendimento inexistente:** se `empreendimento` não achar em `real_estate_developments` para a org → **rejeita**.
4. **Disponibilidade inválida:** valor fora do check constraint → **rejeita**.
5. **Histórico de preço:** se `valor_cents` mudou, grava em `real_estate_history` com `campo='valor_cents'`.
6. **Histórico de status:** se `status` mudou, grava em `real_estate_history` com `campo='status'`.
7. **Transação:** tudo em uma única transação por lote; falha em qualquer linha → rollback total.
8. **Idempotência:** importar o mesmo arquivo 2x não duplica linhas; apenas atualiza se houver mudança.

## Formato Esperado (JSON)

```json
[
 {
 "construtora": "Engenharq",
 "empreendimento": "Residencial Flores",
 "localizacao": "Rua das Acácias, 123",
 "bairro": "Centro",
 "cidade": "João Pessoa",
 "unidade_numero": "101A",
 "bloco": "A",
 "andar": 1,
 "metragem": 65.5,
 "quartos": 2,
 "suites": 1,
 "vagas": 1,
 "tipologia": "2 quartos",
 "preco_cents": 25000000,
 "disponibilidade": "disponivel",
 "atualizado_em": "2026-09-22T10:00:00Z",
 "origem": "engenharq_export_20260922"
 }
]
```

## Fixture STAGING_TEST

Dados fictícios marcados com `STAGING_TEST` no campo `origem`:
- Empreendimento: "Residencial Teste Alpha"
- Unidades: 3 unidades com preços e status variados
- Nenhuma dessas unidades deve aparecer em relatórios comerciais reais