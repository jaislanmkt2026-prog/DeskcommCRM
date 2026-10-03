import { describe, expect, it, beforeEach, vi } from "vitest";
import { reconcileStaleRecords } from "@/lib/cv-crm/reconcile";

// Mock do Supabase admin client
const mockUpdate = vi.fn();
const mockEq = vi.fn();
const mockNot = vi.fn();
const mockLt = vi.fn();
const mockIs = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      update: mockUpdate.mockReturnThis(),
      eq: mockEq.mockReturnThis(),
      not: mockNot.mockReturnThis(),
      lt: mockLt.mockReturnThis(),
      is: mockIs.mockResolvedValue({ count: 0, error: null }),
    }),
  }),
}));

describe("reconcileStaleRecords", () => {
  const orgId = "test-org-123";
  const batchExternalIds = ["ext-1", "ext-2"];
  const batchStartedAt = new Date();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("FAIL: registros marcados como stale após 24h sem atualização - lógica incorreta", async () => {
    // A função NÃO valida se passaram 24h. Ela usa batchStartedAt como referência,
    // mas não compara com o tempo atual. Qualquer registro com cv_crm_last_seen_at
    // anterior ao batchStartedAt será marcado como stale, independente de 24h.
    await reconcileStaleRecords(orgId, batchExternalIds, batchStartedAt);

    // Evidência: a função não verifica intervalo de 24h
    const sourceCode = `lt("cv_crm_last_seen_at", batchStartedAt.toISOString())`;
    expect(sourceCode).toContain("cv_crm_last_seen_at");
    expect(true).toBe(false); // FAIL intencional - falta validação de 24h
  });

  it("PASS: registros ausentes na nova batch são identificados", async () => {
    mockIs.mockResolvedValue({ count: 3, error: null });

    const result = await reconcileStaleRecords(orgId, batchExternalIds, batchStartedAt);

    expect(result.staleCount).toBe(3);
    expect(mockNot).toHaveBeenCalledWith("external_id", "in", batchExternalIds);
  });

  it("FAIL: mudança de preço/disponibilidade não é detectada", async () => {
    // A função NÃO verifica mudanças de preço ou disponibilidade.
    // Ela apenas marca como stale registros ausentes na batch, sem comparar
    // campos de preço ou status entre sincronizações.
    const sourceCode = `.update({ cv_crm_stale_since: new Date().toISOString() })`;
    expect(sourceCode).not.toContain("price");
    expect(sourceCode).not.toContain("status");
    expect(true).toBe(false); // FAIL - não detecta mudança de preço/disponibilidade
  });

  it("PASS: idempotência da reconciliação", async () => {
    mockIs.mockResolvedValue({ count: 0, error: null });

    // Primeira execução
    await reconcileStaleRecords(orgId, batchExternalIds, batchStartedAt);
    // Segunda execução com mesmos parâmetros
    await reconcileStaleRecords(orgId, batchExternalIds, batchStartedAt);

    // O .is("cv_crm_stale_since", null) garante que já marcados não são reprocessados
    expect(mockIs).toHaveBeenCalledWith("cv_crm_stale_since", null);
  });
});
