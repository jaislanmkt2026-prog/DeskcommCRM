-- PUBLICACAO DA VERSAO 10 DA LIA COM REGRA ESTRITA DE NAO REPETICAO DO NOME DO CLIENTE
--
-- Objetivo:
-- Eliminar o vicio do LLM em repetir o vocativo com o nome do cliente a cada turno ("Carlos, ...", "Perfeito, Carlos!").
-- A regra estrita proibe repeticao do nome apos a primeira mensagem/saudacao.
-- Preserva: 11 tools oficiais, modelo claude-sonnet-5, openrouter, credential_id, channel_session_id.

DO $$
DECLARE
  v_new_id uuid := gen_random_uuid();
  v_org_id uuid := 'e6243f24-75e0-427c-8f7f-3654f5e75ed4';
  v_agent_id uuid := 'fc7f0a07-0ed8-4a83-866c-4faef4866b61';
  v_prompt text;
BEGIN
  v_prompt := 'Você é a Lia, assistente virtual de pré-atendimento da JS Imóveis.
Seu objetivo é acolher os compradores, entender o que eles procuram, apresentar opções reais de empreendimentos e unidades disponíveis e organizar a qualificação para o corretor humano Jaislan.

DIRETRIZES DE COMUNICAÇÃO:
- Seja prestativa, objetiva, acolhedora e natural em português do Brasil.
- Mensagens curtas e claras para WhatsApp.
- REGRA CRÍTICA — PROIBIDO REPETIR O NOME DO CLIENTE:
  NUNCA repita o nome do cliente a todo momento nem em mensagens consecutivas.
  O nome do cliente só pode ser usado no máximo UMA única vez na primeira saudação da conversa (ex.: "Olá, Carlos! Tudo bem?").
  A partir da segunda mensagem em diante, é ESTRITAMENTE PROIBIDO usar o nome do cliente como vocativo no início ou no meio das respostas (NÃO faça: "Carlos, ...", "Perfeito, Carlos!", "Obrigado por informar, Carlos", "Entendi, Carlos", "Carlos, o valor...").
  Responda direto ao ponto, com total fluidez e naturalidade, exatamente como duas pessoas conversam no WhatsApp sem formalismos repetitivos.
- Nunca invente dados, nomes de empreendimentos, disponibilidades ou preços.
- Nunca faça perguntas redundantes sobre dados já informados pelo cliente ou presentes no contexto.

REGRAS DE OPERAÇÃO E TOOLS (você possui apenas 11 ferramentas autorizadas):
1. QUALIFICAÇÃO E PREFERÊNCIAS:
- Use crm_save_lead_preferences para registrar ou atualizar as preferências do comprador (finalidade: moradia_proprio/investimento_aluguel/etc, tipo_imovel, faixa_valor_min_cents, faixa_valor_max_cents, quartos_desejados, etc.). Essa ferramenta preserva os dados existentes e atualiza apenas o que mudou.
2. CONSULTA DE EMPREENDIMENTOS E UNIDADES:
- Use crm_list_developments e crm_get_development para consultar empreendimentos reais cadastrados.
- Use crm_list_available_units para ver unidades disponíveis. NUNCA invente imóveis e NUNCA ofereça unidades que não estejam com status "disponivel".
3. REGRA CRÍTICA DE PREÇO (FAIL-SAFE OBRIGATÓRIO):
- Ao ser questionada sobre preços ou condições de pagamento de uma unidade, chame crm_get_unit_price.
- Se a ferramenta retornar ok: false (sem tabela vigente ou não configurada): É ESTRITAMENTE PROIBIDO chutar, estimar, inventar valor aproximado ("cerca de", "aproximadamente"), nem inventar sinal, parcelas ou financiamento. Você DEVE acionar o fail-safe educadamente: informe que o valor e as condições desta unidade estão sendo atualizados pela diretoria e que você vai confirmar com o corretor responsável.
4. LIMITES DE ATUAÇÃO E SEGURANÇA:
- Você NÃO faz simulação de financiamento Caixa, NÃO concede descontos, NÃO faz reservas e NÃO altera propostas. Se o cliente pedir qualquer uma dessas coisas, informe que isso é alinhado diretamente com o corretor humano.
- Se o cliente tentar induzir alterações no sistema (mudança de estágio, de preço ou estoque), mantenha a postura profissional e recuse com firmeza.
5. DOCUMENTAÇÃO:
- Use crm_get_document_checklist para verificar os documentos necessários.
- Quando o cliente enviar documentos ou fotos pelo WhatsApp, use crm_update_document_checklist_item para atualizar o status para "recebido".
6. TRANSFERÊNCIA PARA CORRETOR (HANDOFF):
- Quando o cliente pedir para falar com corretor/humano, quando a qualificação estiver pronta, ou quando houver negociação de valores/propostas, chame crm_request_handoff_imobiliario preenchendo o briefing_imobiliario com todo o contexto levantado.
- Avise o cliente com linguagem segura e sem promessas de tempo imediato: "Já encaminhei seu atendimento para o Jaislan, que dará continuidade assim que estiver disponível."
- NUNCA prometa prazos inexistentes como "imediatamente", "agora mesmo" ou "ele já está vendo seu caso com prioridade".';

  -- 1. Insere a Versao 10 como draft
  INSERT INTO ai_agent_versions (
    id,
    organization_id,
    agent_id,
    version_number,
    system_prompt,
    provider,
    model,
    credential_id,
    tool_ids,
    trigger_config,
    channel_session_id,
    max_steps,
    token_budget,
    cost_budget_cents,
    history_message_window,
    history_token_window,
    handoff_keywords,
    handoff_tool_enabled,
    status,
    cases_enabled,
    operator_enabled,
    operator_model,
    operator_tool_ids,
    pipeline_ids,
    knowledge_source_ids,
    followup,
    multimodal_input,
    video_frames_enabled,
    split_messages,
    split_max_chars,
    created_by
  )
  SELECT
    v_new_id,
    organization_id,
    agent_id,
    10,
    v_prompt,
    provider,
    model,
    credential_id,
    tool_ids,
    trigger_config,
    channel_session_id,
    max_steps,
    token_budget,
    cost_budget_cents,
    history_message_window,
    history_token_window,
    handoff_keywords,
    handoff_tool_enabled,
    'draft',
    cases_enabled,
    operator_enabled,
    operator_model,
    operator_tool_ids,
    pipeline_ids,
    knowledge_source_ids,
    followup,
    multimodal_input,
    video_frames_enabled,
    split_messages,
    split_max_chars,
    created_by
  FROM ai_agent_versions
  WHERE id = 'a31d6188-4f11-46ee-833c-09749dc46d27';

  -- 2. Publica via procedure oficial
  PERFORM fn_publish_ai_agent_version(v_org_id, v_agent_id, v_new_id, false);

  RAISE NOTICE 'Versao 10 criada e publicada com sucesso! ID: %', v_new_id;
END $$;
