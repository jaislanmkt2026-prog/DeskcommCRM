# MISSÃO 8C — MODELO DE INTEGRAÇÃO ENGENHARQ (Rastreabilidade Completa)

## Fonte dos Dados
- **Origem:** CV CRM Engenharq (sistema legado)
- **Artefato capturado:** Tabela oficial de preço
- **Empreendimento piloto:** Jardim das Laranjeiras
- **ID observado no CV:** 14

## Rastreabilidade do Fluxo de Dados

### 1. Origem → Captura
```
CV CRM Engenharq (id=14, empreendimento="Jardim das Laranjeiras")
 ↓ [script: scripts/import-engenharq.ts]
 ↓ - Lê tabela oficial de preços via conexão direta ao banco legado
 ↓ - Preserva ID original como external_id
 ↓ - Mapeia colunas para schema DeskcommCRM
Tabela staging: temp_engenharq_precos
```

**Transformações nesta etapa:**
- `codigo_imovel` (CV) → `external_id` (Deskcomm)
- `valor_venda` (string com R$ e vírgula) → `price_cents` (inteiro em centavos)
- `area_util_m2` (string) → `area_sqm` (numeric)
- `quartos`, `banheiros`, `vagas` (texto) → integer
- `status_venda` (enum legado) → `status` (text constraint)

### 2. Staging → Validação
```
temp_engenharq_precos
 ↓ [validação Zod em lib/real-estate/validation.ts]
 ↓ - Verifica tipos (numeric, integer, text)
 ↓ - Normaliza strings (trim, lowercase para status)
 ↓ - Converte moeda (R$ 1.234,56 → 123456 cents)
 ↓ - Rejeita nulos em campos obrigatórios
 ↓ - Valida faixas realistas (preço > 0, área > 0)
Dados validados prontos para importação
```

**Regras de validação críticas:**
- Preço mínimo: R$ 50.000,00 (5000000 cents)
- Área mínima: 10 m²
- Quartos: 0-10
- Status permitidos: ['disponivel', 'reservado', 'vendido', 'indisponivel']

### 3. Validação → CRM JS (Produção)
```
Dados validados
 ↓ [INSERT INTO properties + property_prices]
 ↓ - Gera UUID v4 para cada propriedade
 ↓ - Define organization_id = e6243f24-75e0-427c-8f7f-3654f5e75ed4
 ↓ - External_id preserva ID original do CV (para rastreabilidade reversa)
 ↓ - Insere em propriedades (properties)
 ↓ - Insere histórico de preços (property_prices) com effective_date
Tabelas produtivas: properties, property_prices
```

**Transformações nesta etapa:**
- `external_id` mantido como referência cruzada
- `organization_id` injetado (multi-tenant isolation)
- `created_at`, `updated_at` gerados (NOW())
- `currency` default 'BRL' se não especificado

### 4. CRM JS → Lia (Agente IA)
```
properties + property_prices
 ↓ [RAG pipeline via Vercel AI SDK]
 ↓ - Indexa embeddings vector(1536) em property_embeddings
 ↓ - Metadata: organization_id, property_id, price_cents, area_sqm
 ↓ - Atualiza índice vetorial Supabase pgvector
Lia acessa via search com filtros de organização
```

**Campos indexados para busca semântica:**
- Descrição do imóvel (texto completo)
- Localização (bairro, cidade)
- Características (quartos, banheiros, vagas, área)
- Faixa de preço (buckets: até 200k, 200-500k, 500k-1M, 1M+)

## Notas de Referência Existentes
1. **"Piloto Imobiliario — Engenharq (proposta)"** — Contexto inicial da parceria
2. **"Central de Dados Imobiliarios CRM JS"** — Arquitetura do schema de dados
3. **"Memoria Imobiliaria CRM JS"** — Histórico de aprendizados do domínio

## Garantia de Rastreabilidade
- **ID Original (CV):** Preservado em `properties.external_id`
- **ID Interno (Deskcomm):** UUID em `properties.id`
- **Log de Importação:** Cada execução gera entrada em `event_log` com tipo `import.engenharq`
- **Audit Trail:** Tabela `property_price_history` registra todas as alterações de preço com timestamp
- **Reversibilidade:** Query por `external_id` permite localizar origem exata no CV

## Próximos Passos (Não Implementados Ainda)
- [ ] Script de importação incremental (detecta mudanças no CV)
- [ ] Dashboard de monitoramento de sync (quantos imóveis importados, erros, etc.)
- [ ] Alerta de divergência (preço no CV ≠ preço no Deskcomm)

---
**Evidência:** Nota criada, documentação consolidada da Missão 8C.
**Status:** Documentação concluída, nenhum código alterado.