/**
 * MCP tools de CAMPANHA — listar, criar o rascunho e conduzir (preparar, testar,
 * iniciar, agendar, pausar, retomar, cancelar).
 *
 * DOUTRINA DIRC (Referenciar, não duplicar): nada aqui reimplementa campanha. A
 * criação é a mesma da rota `POST /api/v1/campaigns` e as ações são as MESMAS
 * funções de `lib/campanhas/acoes.ts` que `POST /api/v1/campaigns/:id/:acao`
 * despacha — máquina de estados, elegibilidade (opt-out, bloqueio, base legal),
 * janela de horário, intervalo e tetos continuam sendo os da campanha. Esta
 * porta não consegue enviar mais rápido do que a tela consegue.
 *
 * Papel `manager`, como a rota: disparar para uma lista não é gesto de `agent`.
 * Por isso as três são `apenasHumano` no catálogo — o agente publicado nunca as
 * alcança; quem as usa é um cliente MCP de confiança (o assistente do dono).
 *
 * org SEMPRE do ctx, NUNCA do input.
 */
import { z } from "zod";

import { audit } from "@/lib/audit";
import { knobsDoCanal } from "@/lib/automation/janela-do-canal";
import {
  agendarAcao,
  cancelarAcao,
  carregarCampanha,
  iniciarAcao,
  pausarAcao,
  prepararAcao,
  testarAcao,
  type Desfecho,
} from "@/lib/campanhas/acoes";
import { FILTRO_VAZIO, filtroDeAudienciaSchema } from "@/lib/campanhas/audiencia";
import { gravarPool } from "@/lib/campanhas/pool-de-numeros";
import { agendarSchema, criarCampanhaSchema, ritmoSchema } from "@/lib/campanhas/schemas";
import type { McpContext, McpToolDefinition } from "../types";

const COLUNAS =
  "id, name, status, channel_session_id, snapshot_total, snapshot_eligible, snapshot_excluded, " +
  "scheduled_at, started_at, completed_at, cancelled_at, created_at, " +
  "intervalo_segundos, janela_inicio_hora, janela_fim_hora, teto_diario, teto_horario, message_body";

function quemAgiu(ctx: McpContext): {
  actorUserId: string | null;
  metadataActor: Record<string, unknown>;
} {
  const actor = ctx.actor;
  if (actor.type === "user") {
    return { actorUserId: actor.id, metadataActor: { actor_type: "user" } };
  }
  return { actorUserId: null, metadataActor: { actor_type: actor.type, actor_id: actor.id } };
}

// ---------------------------------------------------------------------------
// crm_list_campaigns
// ---------------------------------------------------------------------------

const listShape = {
  campaign_id: z
    .string()
    .uuid()
    .optional()
    .describe("Se informado, devolve só esta campanha, com a contagem de envios."),
  status: z
    .string()
    .trim()
    .max(20)
    .optional()
    .describe("Filtra pelo estado (ex.: draft, running, paused, completed)."),
  limit: z.number().int().min(1).max(50).default(20),
};

export const crmListCampaigns: McpToolDefinition<typeof listShape> = {
  name: "crm_list_campaigns",
  description:
    "Lista as campanhas de disparo da organização (mais novas primeiro) com estado, público " +
    "(total/elegíveis/excluídos), ritmo e datas. Com `campaign_id` devolve uma só e também quantas " +
    "mensagens já saíram. Read-only. Use antes de criar ou conduzir uma campanha.",
  inputSchema: listShape,
  category: "read",
  requiresRole: "manager",
  requiresScope: "mcp:read",
  handler: async (input, ctx) => {
    let query = ctx.supabase
      .from("campaigns")
      .select(COLUNAS)
      .eq("organization_id", ctx.organizationId)
      .order("created_at", { ascending: false })
      .limit(input.limit);
    if (input.campaign_id) query = query.eq("id", input.campaign_id);
    if (input.status) query = query.eq("status", input.status);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const campanhas = (data ?? []) as unknown as Array<Record<string, unknown>>;

    if (input.campaign_id && campanhas.length === 1) {
      const { count } = await ctx.supabase
        .from("campaign_recipients")
        .select("id", { count: "exact", head: true })
        .eq("campaign_id", input.campaign_id)
        .not("sent_at", "is", null);
      return { campaigns: [{ ...campanhas[0], enviadas: count ?? 0 }] };
    }
    return { campaigns: campanhas };
  },
};

// ---------------------------------------------------------------------------
// crm_create_campaign
// ---------------------------------------------------------------------------

const createShape = {
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4000).nullable().optional(),
  channel_session_id: z.string().uuid().describe("O número de WhatsApp de onde a campanha sai."),
  message_body: z
    .string()
    .trim()
    .max(4096)
    .nullable()
    .optional()
    .describe("O texto. Aceita as variáveis do CRM (nome etc.)."),
  base_legal: z.enum(["consent", "legitimate_interest"]),
  lia_ref: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .optional()
    .describe("Obrigatória quando a base legal é legitimate_interest."),
  audience_filter: filtroDeAudienciaSchema
    .optional()
    .describe("Quem recebe: por etiqueta (com/sem), funil, etapa, tempo sem interação, limite."),
  channel_session_ids: z.array(z.string().uuid()).max(10).optional(),
  pipeline_id: z.string().uuid().nullable().optional(),
  stage_id: z.string().uuid().nullable().optional(),
  agent_id: z.string().uuid().nullable().optional(),
  ...ritmoSchema.shape,
};

export const crmCreateCampaign: McpToolDefinition<typeof createShape> = {
  name: "crm_create_campaign",
  description:
    "Cria uma campanha em RASCUNHO — não envia nada. Defina o público em `audience_filter` (ex.: " +
    "etiqueta), o texto em `message_body` e o ritmo (`intervalo_segundos`, `janela_inicio_hora`, " +
    "`janela_fim_hora`, `teto_horario`, `teto_diario`) — comece devagar: o número de WhatsApp é por " +
    "QR e o WhatsApp bane por volume. Depois use `crm_run_campaign_action`: preparar → testar → iniciar.",
  inputSchema: createShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const entrada = criarCampanhaSchema.parse(input);

    const { data: canal } = await ctx.supabase
      .from("channel_sessions")
      .select("id")
      .eq("organization_id", ctx.organizationId)
      .eq("id", entrada.channel_session_id)
      .maybeSingle();
    if (!canal) throw new Error("Escolha uma conexão de WhatsApp desta organização.");

    const a = quemAgiu(ctx);
    const { data, error } = await ctx.supabase
      .from("campaigns")
      .insert({
        organization_id: ctx.organizationId,
        name: entrada.name,
        description: entrada.description ?? null,
        channel_session_id: entrada.channel_session_id,
        message_body: entrada.message_body ?? null,
        base_legal: entrada.base_legal,
        lia_ref: entrada.lia_ref ?? null,
        audience_filter: entrada.audience_filter ?? FILTRO_VAZIO,
        intervalo_segundos: entrada.intervalo_segundos ?? null,
        janela_inicio_hora: entrada.janela_inicio_hora ?? null,
        janela_fim_hora: entrada.janela_fim_hora ?? null,
        teto_diario: entrada.teto_diario ?? null,
        teto_horario: entrada.teto_horario ?? null,
        pipeline_id: entrada.pipeline_id ?? null,
        stage_id: entrada.stage_id ?? null,
        agent_id: entrada.agent_id ?? null,
        created_by: a.actorUserId,
      })
      .select(COLUNAS)
      .single();
    if (error || !data) throw new Error(error?.message ?? "Não foi possível criar a campanha.");

    const criada = data as unknown as { id: string };
    if ((entrada.channel_session_ids ?? []).length > 0) {
      // Igual à rota: falha do rodízio não derruba a criação.
      try {
        await gravarPool(ctx.supabase, {
          organizationId: ctx.organizationId,
          campanhaId: criada.id,
          principal: entrada.channel_session_id,
          extras: entrada.channel_session_ids ?? [],
        });
      } catch {
        // a campanha existe e fala pelo número principal.
      }
    }

    void audit({
      action: "campaign.created",
      actorUserId: a.actorUserId,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "campaign",
      resourceId: criada.id,
      requestId: ctx.requestId,
      metadata: { ...a.metadataActor, base_legal: entrada.base_legal, via: "mcp" },
    });

    return data;
  },
};

// ---------------------------------------------------------------------------
// crm_run_campaign_action
// ---------------------------------------------------------------------------

const ACOES = [
  "preparar",
  "testar",
  "iniciar",
  "agendar",
  "pausar",
  "retomar",
  "cancelar",
] as const;

const actionShape = {
  campaign_id: z.string().uuid(),
  acao: z.enum(ACOES),
  scheduled_at: z.string().datetime().optional().describe("Obrigatório em `agendar` (ISO 8601)."),
  contact_id: z
    .string()
    .uuid()
    .optional()
    .describe("Obrigatório em `testar`: quem recebe a mensagem de teste."),
};

const ACAO_AUDITADA = {
  preparar: "campaign.prepared",
  testar: "campaign.test_sent",
  iniciar: "campaign.started",
  retomar: "campaign.resumed",
  agendar: "campaign.scheduled",
  pausar: "campaign.paused",
  cancelar: "campaign.cancelled",
} as const;

export const crmRunCampaignAction: McpToolDefinition<typeof actionShape> = {
  name: "crm_run_campaign_action",
  description:
    "Conduz uma campanha existente. `preparar` congela o público e devolve elegíveis/excluídos (opt-out " +
    "e bloqueados saem sozinhos). `testar` manda UMA mensagem de teste a `contact_id`. `iniciar` começa o " +
    "envio DE VERDADE aos clientes, no ritmo da campanha; `agendar` faz o mesmo numa data; `pausar` e " +
    "`retomar` controlam; `cancelar` encerra. Fluxo seguro: preparar → testar → iniciar. Só inicie quando " +
    "o dono mandar explicitamente.",
  inputSchema: actionShape,
  category: "write",
  requiresRole: "manager",
  requiresScope: "mcp:write",
  handler: async (input, ctx) => {
    const carregada = await carregarCampanha(ctx.supabase, ctx.organizationId, input.campaign_id);
    if (!carregada.ok) throw new Error(carregada.mensagem);
    const campanha = carregada.campanha;
    const agora = new Date();

    let desfecho: Desfecho<Record<string, unknown>>;
    let extra: Record<string, unknown> = {};
    switch (input.acao) {
      case "preparar":
        desfecho = await prepararAcao(ctx.supabase, campanha, agora);
        break;
      case "iniciar":
      case "retomar":
        desfecho = await iniciarAcao(ctx.supabase, campanha, agora);
        break;
      case "agendar": {
        const parsed = agendarSchema.safeParse({ scheduled_at: input.scheduled_at });
        if (!parsed.success) throw new Error("Informe scheduled_at (ISO 8601) para agendar.");
        desfecho = await agendarAcao(
          ctx.supabase,
          campanha,
          new Date(parsed.data.scheduled_at),
          agora,
        );
        extra = { scheduled_at: parsed.data.scheduled_at };
        break;
      }
      case "pausar":
        desfecho = await pausarAcao(ctx.supabase, campanha, agora);
        break;
      case "cancelar":
        desfecho = await cancelarAcao(ctx.supabase, campanha, agora);
        break;
      case "testar": {
        if (!input.contact_id) throw new Error("Informe contact_id para testar.");
        const knobs = await knobsDoCanal(
          ctx.supabase,
          ctx.organizationId,
          campanha.channel_session_id,
        );
        desfecho = await testarAcao(
          ctx.supabase,
          campanha,
          input.contact_id,
          agora,
          knobs.timezone,
        );
        break;
      }
    }

    if (!desfecho.ok) throw new Error(desfecho.mensagem);

    const { ok: _ok, ...resto } = desfecho;
    const a = quemAgiu(ctx);
    void audit({
      action: ACAO_AUDITADA[input.acao],
      actorUserId: a.actorUserId,
      actorApiTokenId: ctx.apiTokenId,
      organizationId: ctx.organizationId,
      resourceType: "campaign",
      resourceId: campanha.id,
      requestId: ctx.requestId,
      metadata: { ...a.metadataActor, ...extra, ...resto, via: "mcp" },
    });
    return { campaign_id: campanha.id, acao: input.acao, ...resto };
  },
};
