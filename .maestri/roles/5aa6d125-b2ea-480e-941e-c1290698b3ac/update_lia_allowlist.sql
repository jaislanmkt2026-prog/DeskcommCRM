-- DOCUMENTAÇÃO TÉCNICA: ALLOWLIST E VERSIONAMENTO DE AGENTES (LIA)
--
-- ATENÇÃO (Auditoria Missão 5D):
-- A tabela 'ai_agents' NÃO possui a coluna 'tool_ids'.
-- A allowlist de tools MCP pertence à entidade versionada 'ai_agent_versions'.
--
-- Versões com status = 'published' são imutáveis (protegidas pela trigger
-- trg_ai_agent_versions_content_immutable). Para atualizar tools ou prompt,
-- deve-se criar um novo draft em ai_agent_versions e publicá-lo através
-- do fluxo oficial de versionamento.
--
-- A allowlist oficial e em vigor da Lia contém exatamente as 11 tools imobiliárias:
-- 1. crm_get_lead
-- 2. crm_list_developments
-- 3. crm_get_development
-- 4. crm_list_available_units
-- 5. crm_get_unit
-- 6. crm_get_unit_price
-- 7. crm_save_lead_preferences
-- 8. crm_save_attendance_summary
-- 9. crm_request_handoff_imobiliario
-- 10. crm_get_document_checklist
-- 11. crm_update_document_checklist_item
--
-- Exemplo de query para conferência da allowlist da versão publicada atual:
SELECT 
  a.id AS agent_id,
  a.name AS agent_name,
  v.version_number,
  v.status,
  v.tool_ids,
  v.created_at
FROM ai_agents a
JOIN ai_agent_versions v ON v.id = a.published_version_id
WHERE a.id = 'fc7f0a07-0ed8-4a83-866c-4faef4866b61';