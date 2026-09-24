# Especificação Técnica — Schema JSONB `qualificacao_imobiliaria`

**Tabela:** `crm_leads` 
**Caminho:** `custom_fields->'qualificacao_imobiliaria'` 
**Objetivo:** Armazenar dados de qualificação de leads imobiliários coletados pela Lia antes do handoff.

---

## Schema JSON (validação em aplicação)

```json
{
  "type": "object",
  "properties": {
    "finalidade": {
      "type": "string",
      "enum": ["moradia_proprio", "investimento_aluguel", "investimento_revenda", "casa_veraneio", "outro"],
      "description": "Finalidade principal do imóvel buscado"
    },
    "tipo_imovel": {
      "type": "string",
      "enum": ["apartamento", "casa_terrea", "sobrado", "cobertura", "studio", "kitnet", "lote_terreno", "sala_comercial", "galpao", "outro"],
      "description": "Tipologia do imóvel desejado"
    },
    "faixa_valor_min_cents": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991,
      "description": "Valor mínimo pretendido em centavos (int64 safe)"
    },
    "faixa_valor_max_cents": {
      "type": "integer",
      "minimum": 0,
      "maximum": 9007199254740991,
      "description": "Valor máximo pretendido em centavos (int64 safe)"
    },
    "quartos_desejados": {
      "type": "integer",
      "minimum": 0,
      "maximum": 20,
      "description": "Quantidade de quartos desejada"
    },
    "garagem_necessaria": {
      "type": "boolean",
      "description": "Se vaga de garagem é requisito obrigatório"
    },
    "preferencias": {
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 100
      },
      "maxItems": 20,
      "description": "Lista de preferências adicionais (ex.: varanda_gourmet, piscina, academia, pet_friendly)"
    },
    "observacoes_comerciais": {
      "type": "string",
      "maxLength": 2000,
      "description": "Observações livres do atendimento comercial"
    },
    "estagio_qualificacao": {
      "type": "string",
      "enum": ["inicial", "documentacao_pendente", "documentacao_completa", "pronto_handoff", "desqualificado"],
      "description": "Estágio atual da qualificação no funil imobiliário"
    },
    "ultima_atualizacao": {
      "type": "string",
      "format": "date-time",
      "description": "Timestamp ISO-8601 UTC da última modificação neste bloco"
    }
  },
  "required": ["finalidade", "tipo_imovel", "estagio_qualificacao", "ultima_atualizacao"],
  "additionalProperties": false
}
```

---

## Validações de negócio

1. **Faixa de valor coerente:** se ambos `faixa_valor_min_cents` e `faixa_valor_max_cents` presentes, exigir `min <= max`.
2. **Documentação pendente:** se `estagio_qualificacao == 'documentacao_pendente'`, deve haver pelo menos um documento com `status='pendente'` na tabela `documents` vinculado ao lead (`entity_kind='contact'`, `entity_id = crm_leads.contact_id`).
3. **Pronto para handoff:** se `estagio_qualificacao == 'pronto_handoff'`, todos os itens obrigatórios do checklist documental devem estar com `status='recebido'`.

---

## Merge parcial seguro (Postgres)

Nunca sobrescrever o bloco inteiro. Usar `jsonb_set` ou operador `||` para mesclar apenas as chaves alteradas:

```sql
-- Exemplo: atualizar apenas estagio_qualificacao e ultima_atualizacao
update crm_leads
set custom_fields = jsonb_set(
  custom_fields,
  '{qualificacao_imobiliaria}',
  (custom_fields->'qualificacao_imobiliaria' || $novo_bloco_parcial)::jsonb
)
where id = $lead_id;
```

Ou via função helper na aplicação:

```typescript
function mergeQualificacaoParcial(
  existing: JsonValue | null,
  patch: Partial<QualificacaoImobiliaria>
): QualificacaoImobiliaria {
  const base = existing?.qualificacao_imobiliaria ?? {};
  return { ...base, ...patch, ultima_atualizacao: new Date().toISOString() };
}
```

---

## Índice GIN existente

A migration 0382 já criou índice GIN em `crm_leads.custom_fields`. Consultas por chave específica usam esse índice:

```sql
-- Exemplo: buscar leads por finalidade
select * from crm_leads
where custom_fields->'qualificacao_imobiliaria'->>'finalidade' = 'investimento_aluguel';
```

---

## Notas de implementação

- **Aplicação valida schema antes de persistir.** Banco não impõe validação JSONB além de `check constraint` opcional.
- **`ultima_atualizacao` é sempre atualizada** mesmo em merge parcial — serve como sinal de freshnees para workers e UI.
- **Campos opcionais podem ser null** no objeto, mas a chave deve existir se o bloco foi inicializado.
- **Enum `estagio_qualificacao` dirige automações da Lia:** transições de estágio disparam verificação de checklist e notificações.