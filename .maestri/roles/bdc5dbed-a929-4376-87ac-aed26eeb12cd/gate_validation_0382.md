# GATE VALIDADO - Schema Imobiliário (Migration 0382)

**Data:** 2026-09-22 
**Validação:** SQL direto no banco `postgres` (Docker `supa-db`)

## Resultado: PASS ✅

### 1. Tabelas (8/8) — TODAS existem
- constructors
- real_estate_developments
- real_estate_units
- real_estate_history
- third_party_properties
- owners
- documents
- negotiations

### 2. FKs (16 corretos)
| Tabela | Coluna | Referencia |
|--------|--------|------------|
| constructors | organization_id | organizations.id |
| real_estate_developments | constructor_id | constructors.id |
| real_estate_developments | organization_id | organizations.id |
| real_estate_units | development_id | real_estate_developments.id |
| real_estate_units | organization_id | organizations.id |
| real_estate_history | unit_id | real_estate_units.id |
| real_estate_history | organization_id | organizations.id |
| third_party_properties | owner_id | owners.id |
| third_party_properties | organization_id | organizations.id |
| owners | organization_id | organizations.id |
| documents | organization_id | organizations.id |
| negotiations | contact_id | contacts.id |
| negotiations | unidade_id | real_estate_units.id |
| negotiations | imovel_terceiros_id | third_party_properties.id |
| negotiations | responsavel_contact_id | contacts.id |
| negotiations | organization_id | organizations.id |

### 3. UNIQUE Constraint
- `real_estate_units_development_id_bloco_numero_key`: UNIQUE(development_id, bloco, numero) — **CONFIRMADO**

### 4. CHECKs de Status (todos ativos)
- `constructors_tipo_integracao_check`: IN ('api', 'csv', 'manual', 'nenhuma')
- `real_estate_developments_status_check`: IN ('planejamento', 'em_andamento', 'concluido', 'pausado')
- `real_estate_units_status_check`: IN ('disponivel', 'reservado', 'vendido', 'bloqueado')
- `third_party_properties_status_captacao_check`: IN ('novo_contato', 'analise', 'captado', 'divulgado', 'vendido')
- `documents_entity_kind_check`: IN ('unit', 'third_party_property', 'negotiation')
- `documents_tipo_check`: IN ('matricula', 'escritura', 'iptu', 'contrato', 'pdf', 'imagem')
- `negotiations_estagio_check`: IN ('interesse', 'visita', 'proposta', 'negociacao', 'fechado', 'perdido')

### 5. RLS Ativo (todas 8 tabelas com rowsecurity=t)
Todas as tabelas possuem policy `tenant_isolation_*_all` FOR ALL USING:
```sql
organization_id IN (SELECT fn_user_org_ids())
```

### 6. Indexes (25 criados)
- Primary keys em todas as tabelas
- Índices por organization_id em todas as tabelas
- Índices específicos: idx_constructors_org, idx_developments_constructor, idx_units_development, idx_history_unit, idx_third_party_owner, idx_documents_entity, idx_negotiations_contact/unit/third_party
- UNIQUE index: real_estate_units_development_id_bloco_numero_key

### 7. Colunas em Contacts (3/3)
| Coluna | Tipo | Nullable | Default |
|--------|------|----------|---------|
| interesse_imobiliario | text | YES | null |
| empreendimento_interesse | text | YES | null |
| imoveis_apresentados | jsonb | NO | '[]'::jsonb |

### 8. Seed
- 5 construtoras cadastradas: Engenharq, Telesil, Rocha, MRV, Solidez
- tipo_integracao = 'nenhuma', ativo = true

---

**Status final:** Schema, constraints, RLS, indexes e seed validados no banco real. Migration 0382 pronta para deploy.