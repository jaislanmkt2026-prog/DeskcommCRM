/**
 * Tools MCP imobiliárias P0 + crm_save_lead_preferences.
 * organization_id vem do contexto (ctx.organizationId), nunca argumento IA.
 */
import { z } from "zod";
import type { McpToolDefinition } from "../types";
import { createAdminClient } from "@/lib/supabase/admin";
import { mergeQualificacaoParcial, qualificacaoImobiliariaSchema } from "@/lib/schemas/imobiliario";
import { triggerHandoff } from "@/lib/ai/handoff/orchestrator";
import { motivoCodigoDoTexto } from "@/lib/escalacao/passagem";

// Helper para extrair orgId e supabase de forma resiliente
function getCtxResources(ctx: any) {
  const orgId = ctx.organizationId ?? ctx.organization_id;
  const supabase = ctx.supabase ?? createAdminClient();
  return { orgId, supabase };
}

// ─── Schema Zod para crm_save_lead_preferences ──────────────────────────────
const saveLeadPreferencesInput = z.object({
  lead_id: z.string().uuid("lead_id deve ser UUID"),
  qualificacao_imobiliaria: z.object({
    finalidade: z
      .enum([
        "moradia_proprio",
        "investimento_aluguel",
        "investimento_revenda",
        "casa_veraneio",
        "outro",
      ])
      .optional(),
    tipo_imovel: z
      .enum([
        "apartamento",
        "casa_terrea",
        "sobrado",
        "cobertura",
        "studio",
        "kitnet",
        "lote_terreno",
        "sala_comercial",
        "galpao",
        "outro",
      ])
      .optional(),
    faixa_valor_min_cents: z.number().int().min(0).max(9007199254740991).optional(),
    faixa_valor_max_cents: z.number().int().min(0).max(9007199254740991).optional(),
    quartos_desejados: z.number().int().min(0).max(20).optional(),
    garagem_necessaria: z.boolean().optional(),
    preferencias: z.array(z.string().max(100)).max(20).optional(),
    observacoes_comerciais: z.string().max(2000).optional(),
    estagio_qualificacao: z
      .enum([
        "inicial",
        "documentacao_pendente",
        "documentacao_completa",
        "pronto_handoff",
        "desqualificado",
      ])
      .optional(),
  }),
});

export const crmSaveLeadPreferences: McpToolDefinition = {
  name: "crm_save_lead_preferences",
  description:
    "Salva preferências de qualificação imobiliária do lead (merge parcial seguro com validação Zod).",
  inputSchema: saveLeadPreferencesInput.shape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    const { lead_id, qualificacao_imobiliaria } = args;

    // Busca lead atual para merge
    const { data: lead, error: fetchErr } = await supabase
      .from("crm_leads")
      .select("custom_fields")
      .eq("id", lead_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchErr) {
      return { ok: false, error: fetchErr.message };
    }
    if (!lead) {
      return { ok: false, error: "Lead não encontrado nesta organização" };
    }

    // Merge parcial seguro com validação Zod
    const merged = mergeQualificacaoParcial(lead.custom_fields as Record<string, unknown> | null, {
      qualificacao_imobiliaria,
    });

    // Persiste
    const { error: updateErr } = await supabase
      .from("crm_leads")
      .update({ custom_fields: merged })
      .eq("id", lead_id)
      .eq("organization_id", orgId);

    if (updateErr) {
      return { ok: false, error: updateErr.message };
    }

    return {
      ok: true,
      message: "Preferências salvas com sucesso",
      ultima_atualizacao: merged.qualificacao_imobiliaria?.ultima_atualizacao,
    };
  },
};

// ─── crm_list_developments ──────────────────────────────────────────────────
const listDevelopmentsInput = z.object({
  constructor_id: z.string().uuid().optional(),
  status: z.enum(["planejamento", "em_andamento", "concluido", "pausado"]).optional(),
});

export const crmListDevelopments: McpToolDefinition = {
  name: "crm_list_developments",
  description:
    "Lista empreendimentos imobiliários da organização (filtro opcional por construtora/status).",
  inputSchema: listDevelopmentsInput.shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    let query = supabase
      .from("real_estate_developments")
      .select("id, nome, localizacao, bairro, cidade, status, constructor_id, created_at")
      .eq("organization_id", orgId)
      .order("nome");

    if (args.constructor_id) {
      query = query.eq("constructor_id", args.constructor_id);
    }
    if (args.status) {
      query = query.eq("status", args.status);
    }

    const { data, error } = await query;
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, developments: data || [] };
  },
};

// ─── crm_get_development ────────────────────────────────────────────────────
const getDevelopmentInput = z.object({
  development_id: z.string().uuid(),
});

export const crmGetDevelopment: McpToolDefinition = {
  name: "crm_get_development",
  description: "Detalhes de um empreendimento específico.",
  inputSchema: getDevelopmentInput.shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    const { data, error } = await supabase
      .from("real_estate_developments")
      .select("*")
      .eq("id", args.development_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: "Empreendimento não encontrado" };
    }
    return { ok: true, development: data };
  },
};

// ─── crm_list_available_units ───────────────────────────────────────────────
const listAvailableUnitsInput = z.object({
  development_id: z.string().uuid(),
});

export const crmListAvailableUnits: McpToolDefinition = {
  name: "crm_list_available_units",
  description:
    "Lista unidades disponíveis de um empreendimento (filtro status=disponivel hardcoded).",
  inputSchema: listAvailableUnitsInput.shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    const { data, error } = await supabase
      .from("real_estate_units")
      .select("id, bloco, numero, andar, metragem, quartos, suites, vagas, status")
      .eq("development_id", args.development_id)
      .eq("organization_id", orgId)
      .eq("status", "disponivel")
      .order("bloco")
      .order("numero");

    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, units: data || [] };
  },
};

// ─── crm_get_unit ───────────────────────────────────────────────────────────
const getUnitInput = z.object({
  unit_id: z.string().uuid(),
});

export const crmGetUnit: McpToolDefinition = {
  name: "crm_get_unit",
  description: "Detalhes de uma unidade específica.",
  inputSchema: getUnitInput.shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    const { data, error } = await supabase
      .from("real_estate_units")
      .select("id, development_id, bloco, numero, andar, metragem, quartos, suites, vagas, status, created_at")
      .eq("id", args.unit_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: error.message };
    }
    if (!data) {
      return { ok: false, error: "Unidade não encontrada" };
    }
    return { ok: true, unit: data };
  },
};

// ─── crm_get_unit_price ─────────────────────────────────────────────────────
const getUnitPriceInput = z.object({
  unit_id: z.string().uuid(),
});

/**
 * Consulta de preço oficial de unidade com validação rigorosa de vigência e status da tabela (0383).
 */
export async function consultarPrecoUnidadeVigente(
  supabase: any,
  orgId: string,
  unitId: string,
  dataReferencia?: string
): Promise<{ ok: boolean; error?: string; detail?: string; price?: any; status?: string }> {
  // 1. Valida existência da tabela no banco (migration 0383)
  const { data: tableExists } = await supabase
    .from("information_schema.tables")
    .select("table_name")
    .eq("table_schema", "public")
    .eq("table_name", "real_estate_price_lists")
    .maybeSingle();

  if (!tableExists) {
    return { ok: false, error: "Tabela de preços não configurada" };
  }

  // 2. Valida unidade e tenant
  const { data: unit, error: unitErr } = await supabase
    .from("real_estate_units")
    .select("id, status, development_id")
    .eq("id", unitId)
    .eq("organization_id", orgId)
    .maybeSingle();

  if (unitErr) {
    return { ok: false, error: unitErr.message };
  }
  if (!unit) {
    return { ok: false, error: "Unidade não encontrada" };
  }
  if (unit.status !== "disponivel") {
    return { ok: false, error: "Unidade não está disponível para venda", status: unit.status };
  }

  const hoje = dataReferencia ?? new Date().toISOString().split("T")[0];

  // 3. Busca tabelas ativas e vigentes:
  // status = 'ativa' E vigencia_inicio <= hoje E (vigencia_fim IS NULL OU vigencia_fim >= hoje)
  const { data: activeLists, error: listErr } = await supabase
    .from("real_estate_price_lists")
    .select("id, nome, etapa, versao, vigencia_inicio, vigencia_fim, fonte, status")
    .eq("organization_id", orgId)
    .eq("status", "ativa")
    .lte("vigencia_inicio", hoje)
    .or(`vigencia_fim.is.null,vigencia_fim.gte.${hoje}`);

  if (listErr) {
    return { ok: false, error: listErr.message };
  }

  if (!activeLists || activeLists.length === 0) {
    return { ok: false, error: "Sem tabela de preços ativa e vigente" };
  }

  const listIds = activeLists.map((l: any) => l.id);

  // 4. Localiza itens disponíveis nas tabelas vigentes
  const { data: items, error: itemErr } = await supabase
    .from("real_estate_price_list_items")
    .select("valor_cents, sinal_cents, parcelas, financiamento, condicoes_chaves, status, price_list_id")
    .eq("unit_id", unitId)
    .eq("organization_id", orgId)
    .eq("status", "disponivel")
    .in("price_list_id", listIds);

  if (itemErr) {
    return { ok: false, error: itemErr.message };
  }

  if (!items || items.length === 0) {
    return { ok: false, error: "Sem preço vigente para esta unidade" };
  }

  // 5. Trata múltiplas tabelas ativas concorrentes para a mesma unidade (fail-safe determinístico)
  const uniqueTableIds = Array.from(new Set(items.map((i: any) => i.price_list_id)));
  if (uniqueTableIds.length > 1) {
    return {
      ok: false,
      error: "ambiguous_active_price_table",
      detail: "Múltiplas tabelas de preço ativas e vigentes encontradas para a mesma unidade.",
    };
  }

  const item = items[0];
  const priceList = activeLists.find((l: any) => l.id === item.price_list_id);

  return {
    ok: true,
    price: {
      valor_cents: item.valor_cents,
      sinal_cents: item.sinal_cents,
      parcelas: item.parcelas,
      financiamento: item.financiamento,
      condicoes_chaves: item.condicoes_chaves,
      tabela: priceList
        ? {
            nome: priceList.nome,
            etapa: priceList.etapa,
            versao: priceList.versao,
            vigencia_inicio: priceList.vigencia_inicio,
            vigencia_fim: priceList.vigencia_fim,
            fonte: priceList.fonte,
          }
        : null,
    },
  };
}

export const crmGetUnitPrice: McpToolDefinition = {
  name: "crm_get_unit_price",
  description:
    "Retorna preço vigente de uma unidade (ok:false se sem preço vigente ou tabela inexistente).",
  inputSchema: getUnitPriceInput.shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    return await consultarPrecoUnidadeVigente(supabase, orgId, args.unit_id);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 2 — TOOLS WRITE + CHECKLIST
// organization_id vem do contexto (ctx.organizationId), nunca argumento IA.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── crm_save_attendance_summary ─────────────────────────────────────────────
const saveAttendanceSummaryInput = z.object({
  lead_id: z.string().uuid("lead_id deve ser UUID"),
  resumo_atendimento: z.string().min(1).max(5000),
});

export const crmSaveAttendanceSummary: McpToolDefinition = {
  name: "crm_save_attendance_summary",
  description: "Grava resumo de atendimento na timeline do lead.",
  inputSchema: saveAttendanceSummaryInput.shape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    const { lead_id, resumo_atendimento } = args;

    // Valida existência do lead na org
    const { data: lead, error: fetchErr } = await supabase
      .from("crm_leads")
      .select("id")
      .eq("id", lead_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchErr) {
      return { ok: false, error: fetchErr.message };
    }
    if (!lead) {
      return { ok: false, error: "Lead não encontrado nesta organização" };
    }

    // Grava atividade na timeline
    const { error: insertErr } = await supabase.from("crm_lead_activities").insert({
      organization_id: orgId,
      lead_id: lead_id,
      type: "handoff_triggered",
      source_module: "ai",
      payload: {
        resumo: resumo_atendimento,
        origem: "lia_qualification",
      },
      metadata: {
        actor_kind: "ai_agent",
        reason: "requested_human",
      },
    });

    if (insertErr) {
      return { ok: false, error: insertErr.message };
    }

    return { ok: true, message: "Resumo de atendimento gravado com sucesso" };
  },
};

// ─── crm_request_handoff_imobiliario ─────────────────────────────────────────
const requestHandoffInput = z.object({
  conversation_id: z.string().uuid(),
  reason: z.string().min(1).max(500).default("requested_human"),
  urgency: z.enum(["low", "normal", "high"]).default("normal"),
  target_user_id: z.string().uuid().optional(),
  briefing_imobiliario: z
    .object({
      lead_id: z.string().uuid(),
      empreendimento_interesse: z.string().optional(),
      unidade_ref: z.string().optional(),
      valor_negociado_cents: z.number().int().min(0).optional(),
      condicoes_especiais: z.string().max(2000).optional(),
    })
    .optional(),
});

export const crmRequestHandoffImobiliario: McpToolDefinition = {
  name: "crm_request_handoff_imobiliario",
  description:
    "Aciona handoff bot→humano enriquecido com dados imobiliários (reusa orchestrator existente).",
  inputSchema: requestHandoffInput.shape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    const { conversation_id, reason, urgency, target_user_id, briefing_imobiliario } = args;

    // Enriquece o motivo com dados imobiliários se disponíveis
    let motivoTexto = reason;
    if (briefing_imobiliario) {
      const partes = [reason];
      if (briefing_imobiliario.empreendimento_interesse) {
        partes.push(`Empreendimento: ${briefing_imobiliario.empreendimento_interesse}`);
      }
      if (briefing_imobiliario.unidade_ref) {
        partes.push(`Unidade: ${briefing_imobiliario.unidade_ref}`);
      }
      if (briefing_imobiliario.valor_negociado_cents) {
        partes.push(`Valor: R$ ${(briefing_imobiliario.valor_negociado_cents / 100).toFixed(2)}`);
      }
      if (briefing_imobiliario.condicoes_especiais) {
        partes.push(`Condições: ${briefing_imobiliario.condicoes_especiais}`);
      }
      motivoTexto = partes.join(" | ");
    }

    // Busca contact_id da conversa para o orchestrator
    const { data: conv } = await supabase
      .from("conversations")
      .select("contact_id")
      .eq("id", conversation_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    // Chama o orquestrador de handoff existente
    const result = await triggerHandoff({
      conversationId: conversation_id,
      organizationId: orgId,
      reason: "requested_human",
      origem: "mcp_imobiliario",
      motivoTexto,
      leadId: briefing_imobiliario?.lead_id ?? null,
      metadata: briefing_imobiliario ? { briefing_imobiliario } : {},
    });

    return {
      handoff_recorded: result.triggered,
      conversation_id,
      assigned_to: null, // assignment é feito pelo orchestrator
      queued: false,
      position: null,
      next_action: result.triggered
        ? "O cliente já foi avisado de que uma pessoa vai assumir — encerre o turno."
        : "A conversa não saiu do atendimento automático.",
    };
  },
};

// ─── crm_get_document_checklist ──────────────────────────────────────────────
const getDocumentChecklistInput = z.object({
  contact_id: z.string().uuid(),
});

export const crmGetDocumentChecklist: McpToolDefinition = {
  name: "crm_get_document_checklist",
  description:
    "Lista itens de checklist documental de um contato (status: pendente/recebido/recusado).",
  inputSchema: getDocumentChecklistInput.shape,
  category: "read",
  requiresRole: "agent",
  requiresScope: "mcp:read",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);

    const { data, error } = await supabase
      .from("document_checklist_items")
      .select("id, checklist_key, status, recebido_em, recusado_motivo, message_id, created_at")
      .eq("contact_id", args.contact_id)
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      return { ok: false, error: error.message };
    }

    return { ok: true, items: data || [] };
  },
};

// ─── crm_update_document_checklist_item ──────────────────────────────────────
const updateDocumentChecklistItemInput = z.object({
  item_id: z.string().uuid(),
  status: z.enum(["recebido", "pendente", "recusado"]),
  message_id: z.string().uuid().optional(),
  recusado_motivo: z.string().max(500).optional(),
});

export const crmUpdateDocumentChecklistItem: McpToolDefinition = {
  name: "crm_update_document_checklist_item",
  description: "Atualiza status de item de checklist e vincula message_id ao documento real.",
  inputSchema: updateDocumentChecklistItemInput.shape,
  category: "write",
  requiresRole: "agent",
  requiresScope: "mcp:write",
  handler: async (args, ctx) => {
    const { orgId, supabase } = getCtxResources(ctx);
    const { item_id, status, message_id, recusado_motivo } = args;

    // Valida que o item pertence à org
    const { data: item, error: fetchErr } = await supabase
      .from("document_checklist_items")
      .select("id, organization_id")
      .eq("id", item_id)
      .eq("organization_id", orgId)
      .maybeSingle();

    if (fetchErr) {
      return { ok: false, error: fetchErr.message };
    }
    if (!item) {
      return { ok: false, error: "Item de checklist não encontrado" };
    }

    // Valida message_id se fornecido
    if (message_id) {
      const { data: msg } = await supabase
        .from("messages")
        .select("id, media_storage_path, media_url")
        .eq("id", message_id)
        .eq("organization_id", orgId)
        .maybeSingle();

      if (!msg) {
        return { ok: false, error: "Mensagem/documento não encontrado nesta organização" };
      }
      if (!msg.media_storage_path && !msg.media_url) {
        return { ok: false, error: "Mensagem não possui documento anexado" };
      }
    }

    const updateData: Record<string, unknown> = {
      status,
      ...(status === "recebido" ? { recebido_em: new Date().toISOString() } : {}),
      ...(message_id ? { message_id } : {}),
      ...(recusado_motivo ? { recusado_motivo } : {}),
    };

    const { error: updateErr } = await supabase
      .from("document_checklist_items")
      .update(updateData)
      .eq("id", item_id)
      .eq("organization_id", orgId);

    if (updateErr) {
      return { ok: false, error: updateErr.message };
    }

    return { ok: true, message: "Item de checklist atualizado", status };
  },
};
