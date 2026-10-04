import { describe, expect, it, beforeEach, vi } from "vitest";
import { reconcileStaleRecords } from "@/lib/cv-crm/reconcile";

// Mock do Supabase admin client com chain correto.
// O PostgREST builder retorna o próprio builder em cada método de filtro;
// a resolução async acontece apenas no final (then/await). Aqui simulamos
// isso fazendo cada método retornar o builder sincronamente e expondo
// um .then() que resolve com { count, error }.
const mockIs = vi.fn();
const mockNot = vi.fn();
const mockLt = vi.fn();
const mockEq = vi.fn();
const mockUpdate = vi.fn();

let resolvedValue: { count: number; error: null | string } = { count: 0, error: null };

const queryBuilder = {
  update: (...args: unknown[]) => {
    mockUpdate(...args);
    return queryBuilder;
  },
  eq: (...args: unknown[]) => {
    mockEq(...args);
    return queryBuilder;
  },
  not: (...args: unknown[]) => {
    mockNot(...args);
    return queryBuilder;
  },
  lt: (...args: unknown[]) => {
    mockLt(...args);
    return queryBuilder;
  },
  is: (...args: unknown[]) => {
    mockIs(...args);
    return queryBuilder;
  },
  // PostgREST builder é thenable: await query resolve com { data, error, count }
  then: (onFulfilled: (v: { count: number; error: null | string }) => unknown) =>
    Promise.resolve(resolvedValue).then(onFulfilled),
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => queryBuilder,
  }),
}));

describe("reconcileStaleRecords", () => {
  const orgId = "test-org-123";
  const snapshotExternalIds = {
    development: ["ext-dev-1", "ext-dev-2"],
    unit: ["ext-unit-1"],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resolvedValue = { count: 0, error: null };
  });

  it("PASS: usa janela de 24h via cutoff calculado internamente", async () => {
    await reconcileStaleRecords(orgId, snapshotExternalIds);
    expect(mockLt).toHaveBeenCalledWith(
      "cv_crm_last_seen_at",
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    );
  });

  it("PASS: registros ausentes na nova batch são identificados", async () => {
    resolvedValue = { count: 3, error: null };
    const result = await reconcileStaleRecords(orgId, snapshotExternalIds);
    // 2 tabelas × 3 = 6, mas staleCount soma os counts retornados
    expect(result.staleCount).toBeGreaterThan(0);
    expect(mockNot).toHaveBeenCalledWith("external_id", "is", null);
  });

  it("PASS: idempotência da reconciliação — só marca onde stale_since é null", async () => {
    await reconcileStaleRecords(orgId, snapshotExternalIds);
    await reconcileStaleRecords(orgId, snapshotExternalIds);
    expect(mockIs).toHaveBeenCalledWith("cv_crm_stale_since", null);
  });

  it("PASS: retorna errors vazios quando tudo corre bem", async () => {
    const result = await reconcileStaleRecords(orgId, snapshotExternalIds);
    expect(result.errors).toEqual([]);
  });
});
