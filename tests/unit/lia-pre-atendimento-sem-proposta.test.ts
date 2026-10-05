import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pickToolsFromMcp: vi.fn((input: { toolIds: string[]; proposalAiDraftEnabled: boolean }) => {
    const ids = [...input.toolIds];
    if (input.proposalAiDraftEnabled) {
      for (const id of ["crm_draft_proposal", "crm_preparar_proposta"]) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return Object.fromEntries(ids.map((id) => [id, {}]));
  }),
  capacidades: vi.fn(async () => ["propostas"]),
}));

vi.mock("@/lib/ai/runtime/tools", () => ({ pickToolsFromMcp: mocks.pickToolsFromMcp }));
vi.mock("@/lib/ai/runtime/mcp_token", () => ({
  mintEphemeralToken: vi.fn(async () => ({ id: "tok-1" })),
  revokeEphemeralToken: vi.fn(async () => {}),
}));
vi.mock("@/lib/instalacao/modulos", () => ({ modulosLigados: vi.fn(async () => []) }));
vi.mock("@/lib/organizacao/capacidades", () => ({ capacidadesDaOrganizacao: mocks.capacidades }));
vi.mock("@/lib/atendimento/fronteira-server", () => ({
  currentExecutionJob: () => undefined,
  currentExecutionBoundary: () => undefined,
}));

const { buildMcpTurnTools } = await import("@/lib/agent-engine/edge/crm/mcp-tools");

const HANDOFF_IMOBILIARIO = "crm_request_handoff_imobiliario";
const PRECO = "crm_get_unit_price";
const DRAFT = "crm_draft_proposal";
const PREPARAR = "crm_preparar_proposta";

async function montar(input: { toolIds: string[]; proposalAiDraftEnabled: boolean }) {
  return buildMcpTurnTools(
    { supabase: {} as never },
    { organizationId: "org-1", jobId: "job-1", contactId: "contact-1" },
    {
      agentId: "agente-1",
      toolIds: input.toolIds,
      proposalAiDraftEnabled: input.proposalAiDraftEnabled,
      pipelineIds: [],
      followup: null,
    } as never,
    { warn: vi.fn() } as never,
  );
}

beforeEach(() => {
  mocks.pickToolsFromMcp.mockClear();
  mocks.capacidades.mockClear();
});

describe("pré-atendimento imobiliário não recebe ferramentas de proposta", () => {
  it("remove proposta marcada explicitamente e desliga a auto-injeção", async () => {
    const out = await montar({
      toolIds: [HANDOFF_IMOBILIARIO, PRECO, DRAFT, PREPARAR],
      proposalAiDraftEnabled: true,
    });

    const args = mocks.pickToolsFromMcp.mock.calls[0]![0];
    expect(args.toolIds).toEqual([HANDOFF_IMOBILIARIO, PRECO]);
    expect(args.proposalAiDraftEnabled).toBe(false);
    expect(out?.toolIds).toEqual([HANDOFF_IMOBILIARIO, PRECO]);
  });

  it("bloqueia a auto-injeção mesmo quando proposta não está em tool_ids", async () => {
    const out = await montar({
      toolIds: [HANDOFF_IMOBILIARIO, PRECO],
      proposalAiDraftEnabled: true,
    });

    expect(mocks.pickToolsFromMcp.mock.calls[0]![0].proposalAiDraftEnabled).toBe(false);
    expect(out?.toolIds).not.toContain(DRAFT);
    expect(out?.toolIds).not.toContain(PREPARAR);
  });

  it("não muda outros agentes que legitimamente usam proposta", async () => {
    const out = await montar({ toolIds: ["crm_search_contacts"], proposalAiDraftEnabled: true });

    expect(mocks.pickToolsFromMcp.mock.calls[0]![0].proposalAiDraftEnabled).toBe(true);
    expect(out?.toolIds).toContain(DRAFT);
    expect(out?.toolIds).toContain(PREPARAR);
  });
});
