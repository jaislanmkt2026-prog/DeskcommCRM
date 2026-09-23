# PROPOSTA PIPELINE AUTOMAÇÃO ENGENHARQ
**Data:** 2026-09-23
**Autor:** Agente de IA (Missão 8C)
**Org:** JS Imóveis (e6243f24-75e0-427c-8f7f-3654f5e75ed4)
**Status:** CONCEITUAL — Não implementado

---

## Fluxo Proposto
CV CRM → obtenção da tabela → parser → staging → validação → comparação → atualização → histórico → Lia

---

## Classificação por Etapa

### 1. CV CRM (Origem dos Dados)
**Classificação:** ETAPA MANUAL
**Descrição:** Extração manual da tabela de imóveis do sistema CV CRM legado.
**Justificativa:** Sistema externo sem API disponível para integração direta no MVP. Operador humano realiza exportação.
**Pré-requisito futuro:** Conector API no CV CRM ou middleware de ETL.

### 2. Obtenção da Tabela (Ingestão)
**Classificação:** ETAPA AUTOMATIZÁVEL
**Descrição:** Upload do arquivo CSV/Excel para bucket Supabase (`engenharq-imports`) ou endpoint `/api/v1/engenharq/import`.
**Implementação futura:** Endpoint POST aceitando multipart/form-data com validação de tipo e tamanho. Bucket privado com URLs assinadas.
**Risco:** Formato inconsistente entre exportações.

### 3. Parser (Normalização)
**Classificação:** ETAPA AUTOMATIZÁVEL
**Descrição:** Worker lê arquivo bruto, normaliza colunas (endereco, valor, status, proprietario) para schema intermediário.
**Implementação futura:** TypeScript com Zod schema validation. Mapeamento de colunas variáveis via config JSON em `pipeline.settings.field_mappings`.
**Risco:** Colunas renomeadas ou ausentes exigem reconfiguração manual.

### 4. Staging (Tabela Temporária)
**Classificação:** ETAPA AUTOMATIZÁVEL
**Descrição:** Dados normalizados inseridos em tabela `engenharq_staging` com `import_batch_id`, `organization_id`, `raw_json`, `parsed_fields`, `status`.
**Implementação futura:** COPY ou INSERT bulk. RLS aplicado. Retenção de 30 dias com job de limpeza.
**Segurança:** Ninguém além do worker tem acesso direto à staging.

### 5. Validação (Qualidade)
**Classificação:** ETAPA QUE EXIGE APROVAÇÃO
**Descrição:** Regras de negócio aplicadas: CPF/CNPJ válido, endereço geocodificado, valor dentro de faixa esperada, duplicata detectada.
**Implementação futura:** Worker executa regras configuráveis em `pipeline.validation_rules`. Resultados em `engenharq_validation_errors`.
**Fluxo de aprovação:** Lotes com >10% de erro vão para fila de revisão manual via UI. Lotes válidos seguem automaticamente.

### 6. Comparação (Diff com Base Atual)
**Classificação:** ETAPA AUTOMATIZÁVEL
**Descrição:** JOIN entre staging e `crm_leads` por chave única (ex: `external_id` ou combinação endereco+proprietario). Identifica: NOVOS, ATUALIZADOS, REMOVIDOS.
**Implementação futura:** Query SQL com FULL OUTER JOIN ou LEFT JOIN + COALESCE. Gera `engenharq_diff_report` com contagens e IDs afetados.
**Performance:** Index em `external_id` e campos de busca.

### 7. Atualização (Upsert no CRM Core)
**Classificação:** ETAPA QUE EXIGE APROVAÇÃO
**Descrição:** Aplicação das mudanças no `crm_leads` e tabelas relacionadas (`crm_lead_activities`, `crm_lead_links`).
**Implementação futura:** Transaction PostgreSQL com upsert (INSERT ... ON CONFLICT). Audit log em `api_audit_log`. Rollback automático se qualquer linha falhar.
**Fluxo de aprovação:** Preview do diff exibido na UI para operador confirmar antes de aplicar. Botão "Aplicar Lote".

### 8. Histórico (Versionamento)
**Classificação:** ETAPA AUTOMATIZÁVEL
**Descrição:** Snapshot do estado antes/depois em tabela `engenharq_import_history` com `batch_id`, `applied_at`, `applied_by`, `summary_json`.
**Implementação futura:** Trigger ou INSERT explícito após commit bem-sucedido. Permite rollback pontual de lote específico.
**Retenção:** Indefinida (dados críticos de auditoria).

### 9. Lia (Notificação ao Usuário)
**Classificação:** ETAPA FUTURA
**Descrição:** Agente Lia envia mensagem WhatsApp ou notificação in-app informando: "Lote #XYZ processado: 15 novos, 3 atualizados, 0 erros."
**Implementação futura:** Integração com sistema de notificações existente (`notifications` table + worker de envio). Template de mensagem configurável em `pipeline.notification_templates`.
**Dependência:** Sistema de notificações maduras e preferência do usuário.

---

## Resumo de Dependências Técnicas

| Componente | Status Atual | Ação Necessária |
|---|---|---|
| Supabase Storage bucket | ✅ Existe (`whatsapp-media`) | Criar bucket `engenharq-imports` |
| Worker framework | ✅ Existe (`event_log` + cron) | Adicionar novo consumer `engenharq_import` |
| Audit log | ✅ Existe (`api_audit_log`) | Reutilizar infraestrutura |
| Validação Zod | ✅ Existe em outros endpoints | Criar schemas específicos para Engenharq |
| Notificações | ⚠️ Parcial | Expandir para WhatsApp via WAHA |
| UI de importação | ❌ Não existe | Criar página `/settings/engenharq/import` |
| Preview de diff | ❌ Não existe | Criar componente React comparativo |

---

## Próximos Passos Recomendados (Ordem de Execução)

1. **Schema DB:** Criar tabelas `engenharq_imports`, `engenharq_staging`, `engenharq_validation_errors`, `engenharq_import_history`
2. **Storage:** Criar bucket Supabase `engenharq-imports` com política de retenção
3. **Endpoint:** POST `/api/v1/engenharq/import` com upload e enqueue de evento
4. **Worker:** Implementar consumer `engenharq_import_worker.ts` com parser + validação
5. **UI Básica:** Página de upload com lista de lotes processados
6. **UI Avançada:** Preview de diff e botão de aprovação
7. **Notificação:** Integração com Lia para feedback automático

---

## Riscos Identificados

- **Formato inconsistente:** Cada exportação do CV CRM pode ter colunas diferentes → Mitigar com config flexível de mapeamento
- **Volume alto:** Milhares de imóveis podem sobrecarregar parser síncrono → Mitigar com processamento assíncrono em chunks
- **Duplicatas sutis:** Mesmo imóvel com endereco ligeiramente diferente → Mitigar com fuzzy matching no diff
- **Aprovação negligenciada:** Operador não revisa lotes pendentes → Mitigar com alerta após 24h

---

**FIM DA NOTA**