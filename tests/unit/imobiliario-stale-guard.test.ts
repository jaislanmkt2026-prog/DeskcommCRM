import { describe, expect, test, vi } from "vitest";
import {
  crmGetUnit,
  crmListAvailableUnits,
} from "@/lib/mcp/tools/imobiliario";

describe("tools imobiliárias — fail-closed para unidade stale do CV CRM", () => {
  const organizationId = "e6243f24-75e0-427c-8f7f-3654f5e75ed4";
  const developmentId = "b1c2d3e4-f5a6-47b8-c9d0-e1f2a3b4c5d6";
  const unitId = "c2d3e4f5-a6b7-48c9-d0e1-f2a3b4c5d6e7";

  test("crm_list_available_units exige cv_crm_stale_since IS NULL", async () => {
    let orderCalls = 0;
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.is = vi.fn(() => query);
    query.order = vi.fn(() => {
      orderCalls += 1;
      return orderCalls >= 2
        ? Promise.resolve({ data: [], error: null })
        : query;
    });

    const supabase = {
      from: vi.fn(() => query),
    };

    const result = await crmListAvailableUnits.handler(
      { development_id: developmentId },
      { organizationId, supabase } as never
    );

    expect(result).toEqual({ ok: true, units: [] });
    expect(query.is).toHaveBeenCalledWith("cv_crm_stale_since", null);
  });

  test("crm_get_unit falha fechado quando a unidade está stale", async () => {
    const staleSince = "2026-10-03T12:00:00.000Z";
    const query: Record<string, unknown> = {};
    query.select = vi.fn(() => query);
    query.eq = vi.fn(() => query);
    query.maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: unitId,
        development_id: developmentId,
        status: "disponivel",
        cv_crm_stale_since: staleSince,
      },
      error: null,
    });

    const supabase = {
      from: vi.fn(() => query),
    };

    const result = await crmGetUnit.handler(
      { unit_id: unitId },
      { organizationId, supabase } as never
    );

    expect(result).toEqual({
      ok: false,
      error: "cv_crm_unit_stale",
      stale_since: staleSince,
    });
    expect(query.select).toHaveBeenCalledWith(
      expect.stringContaining("cv_crm_stale_since")
    );
  });
});
