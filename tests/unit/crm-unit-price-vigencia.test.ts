import { describe, test, expect, vi } from "vitest";
import { consultarPrecoUnidadeVigente } from "@/lib/mcp/tools/imobiliario";

describe("crm_get_unit_price — Validação de Vigência e Status (Missão 5D)", () => {
  const orgId = "e6243f24-75e0-427c-8f7f-3654f5e75ed4";
  const unitId = "b1c2d3e4-f5a6-47b8-c9d0-e1f2a3b4c5d6";
  const dataHoje = "2026-09-24";

  // Helper para criar mock do Supabase
  function criarMockSupabase(opcoes: {
    tableExists: boolean;
    unitStatus?: string;
    priceLists?: Array<Record<string, unknown>>;
    items?: Array<Record<string, unknown>>;
  }) {
    return {
      from: vi.fn((tabela: string) => {
        if (tabela === "information_schema.tables") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: opcoes.tableExists ? { table_name: "real_estate_price_lists" } : null,
              error: null,
            }),
          };
        }

        if (tabela === "real_estate_units") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: opcoes.unitStatus
                ? { id: unitId, status: opcoes.unitStatus, development_id: "dev-1" }
                : null,
              error: null,
            }),
          };
        }

        if (tabela === "real_estate_price_lists") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            or: vi.fn().mockResolvedValue({
              data: opcoes.priceLists ?? [],
              error: null,
            }),
          };
        }

        if (tabela === "real_estate_price_list_items") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: opcoes.items ?? [],
              error: null,
            }),
          };
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        };
      }),
    };
  }

  test("A. Tabela inexistente (0383 não aplicada) -> ok: false", async () => {
    const supabase = criarMockSupabase({ tableExists: false });
    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Tabela de preços não configurada");
  });

  test("B. Tabela ativa e vigente -> ok: true", async () => {
    const supabase = criarMockSupabase({
      tableExists: true,
      unitStatus: "disponivel",
      priceLists: [
        {
          id: "list-1",
          nome: "Tabela Oficial Setembro 2026",
          status: "ativa",
          vigencia_inicio: "2026-09-01",
          vigencia_fim: "2026-09-30",
        },
      ],
      items: [
        {
          price_list_id: "list-1",
          valor_cents: 45000000,
          sinal_cents: 4500000,
          status: "disponivel",
        },
      ],
    });

    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(true);
    expect(res.price?.valor_cents).toBe(45000000);
    expect(res.price?.tabela?.nome).toBe("Tabela Oficial Setembro 2026");
  });

  test("C. Tabela inativa -> ok: false", async () => {
    const supabase = criarMockSupabase({
      tableExists: true,
      unitStatus: "disponivel",
      priceLists: [], // O filtro status='ativa' retorna vazio
    });

    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Sem tabela de preços ativa e vigente");
  });

  test("D. Vigência futura (inicia após hoje) -> ok: false", async () => {
    const supabase = criarMockSupabase({
      tableExists: true,
      unitStatus: "disponivel",
      priceLists: [], // O filtro lte(vigencia_inicio, hoje) retorna vazio
    });

    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Sem tabela de preços ativa e vigente");
  });

  test("E. Vigência expirada (terminou antes de hoje) -> ok: false", async () => {
    const supabase = criarMockSupabase({
      tableExists: true,
      unitStatus: "disponivel",
      priceLists: [], // O filtro vigencia_fim >= hoje retorna vazio
    });

    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Sem tabela de preços ativa e vigente");
  });

  test("F. Vigência com vigencia_fim NULL (indeterminada) -> ok: true se inicio começou", async () => {
    const supabase = criarMockSupabase({
      tableExists: true,
      unitStatus: "disponivel",
      priceLists: [
        {
          id: "list-2",
          nome: "Tabela Contínua 2026",
          status: "ativa",
          vigencia_inicio: "2026-01-01",
          vigencia_fim: null,
        },
      ],
      items: [
        {
          price_list_id: "list-2",
          valor_cents: 52000000,
          status: "disponivel",
        },
      ],
    });

    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(true);
    expect(res.price?.valor_cents).toBe(52000000);
    expect(res.price?.tabela?.vigencia_fim).toBeNull();
  });

  test("G. Duas tabelas ativas e vigentes concorrentes para a mesma unidade -> fail-safe / ambiguidade", async () => {
    const supabase = criarMockSupabase({
      tableExists: true,
      unitStatus: "disponivel",
      priceLists: [
        { id: "list-1", nome: "Tabela A", status: "ativa", vigencia_inicio: "2026-09-01", vigencia_fim: null },
        { id: "list-2", nome: "Tabela B", status: "ativa", vigencia_inicio: "2026-09-01", vigencia_fim: null },
      ],
      items: [
        { price_list_id: "list-1", valor_cents: 45000000, status: "disponivel" },
        { price_list_id: "list-2", valor_cents: 44000000, status: "disponivel" },
      ],
    });

    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("ambiguous_active_price_table");
  });

  test("H. Unidade reservada ou vendida -> não oferecer como disponível (ok: false)", async () => {
    const supabase = criarMockSupabase({
      tableExists: true,
      unitStatus: "vendida", // Unidade já vendida
    });

    const res = await consultarPrecoUnidadeVigente(supabase, orgId, unitId, dataHoje);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("Unidade não está disponível para venda");
    expect(res.status).toBe("vendida");
  });
});
