import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  fetchBatch: vi.fn(),
  reconcile: vi.fn(),
  rpc: vi.fn(),
  operations: [] as Array<{ table: string; method: string; payload?: unknown }>,
  organizationExists: true,
  logInsertError: null as null | { message: string },
  stagingError: null as null | { message: string },
  applyResult: 0 as number,
  applyError: null as null | { message: string },
  validationResults: [] as Array<{ data: unknown; error: null | { message: string } }>,
}));

vi.mock("@/lib/env", () => ({
  env: { CV_CRM_ORG_ID: "org-config" },
}));

vi.mock("@/lib/cv-crm/adapter", () => ({
  fetchBatch: h.fetchBatch,
}));

vi.mock("@/lib/cv-crm/reconcile", () => ({
  reconcileStaleRecords: h.reconcile,
}));

vi.mock("@/lib/supabase/admin", () => {
  function builder(table: string) {
    const b: Record<string, unknown> = {};

    b.select = vi.fn(() => b);
    b.eq = vi.fn(() => b);
    b.lt = vi.fn(() => b);
    b.maybeSingle = vi.fn(async () => ({
      data: h.organizationExists ? { id: "org-config" } : null,
      error: null,
    }));
    b.insert = vi.fn(async (payload: unknown) => {
      h.operations.push({ table, method: "insert", payload });
      return { error: table === "cv_crm_ingestion_logs" ? h.logInsertError : null };
    });
    b.upsert = vi.fn(async (payload: unknown) => {
      h.operations.push({ table, method: "upsert", payload });
      return { error: table === "cv_crm_staging" ? h.stagingError : null };
    });
    b.update = vi.fn((payload: unknown) => {
      h.operations.push({ table, method: "update", payload });
      return b;
    });
    b.then = (
      resolve: (value: { data: null; count: null; error: null }) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve({ data: null, count: null, error: null }).then(resolve, reject);

    return b;
  }

  return {
    createAdminClient: () => ({
      from: (table: string) => builder(table),
      rpc: h.rpc,
    }),
  };
});

import { runCvCrmIngest } from "@/lib/cv-crm/ingest";

describe("runCvCrmIngest — runtime fail-closed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.operations.splice(0);
    h.organizationExists = true;
    h.logInsertError = null;
    h.stagingError = null;
    h.applyResult = 0;
    h.applyError = null;
    h.validationResults.splice(0);
    h.fetchBatch.mockResolvedValue([]);
    h.reconcile.mockResolvedValue({ staleCount: 0, errors: [] });
    h.rpc.mockImplementation(async (name: string) => {
      if (name === "fn_validate_cv_crm_record") {
        return h.validationResults.shift() ?? { data: { valid: true, errors: [] }, error: null };
      }
      if (name === "fn_apply_cv_crm_valid_records") {
        return { data: h.applyResult, error: h.applyError };
      }
      throw new Error(`RPC inesperada: ${name}`);
    });
  });

  it("recusa override de tenant diferente da configuracao server-side", async () => {
    const result = await runCvCrmIngest({ orgId: "org-outra" });

    expect(result.status).toBe("error");
    expect(result.errors?.join(" ")).toMatch(/diverge de CV_CRM_ORG_ID/i);
    expect(h.fetchBatch).not.toHaveBeenCalled();
  });

  it("fonte indisponivel falha fechada e deixa log tecnico failed", async () => {
    h.fetchBatch.mockRejectedValue(new Error("CV CRM API unavailable: offline"));

    const result = await runCvCrmIngest();

    expect(result.status).toBe("error");
    expect(result.processed).toBe(0);
    expect(result.errors?.join(" ")).toMatch(/unavailable/i);
    expect(h.fetchBatch).toHaveBeenCalledWith("org-config");

    const finalLog = h.operations.find(
      (op) =>
        op.table === "cv_crm_ingestion_logs" &&
        op.method === "update" &&
        typeof op.payload === "object" &&
        op.payload !== null &&
        "status" in op.payload &&
        (op.payload as { status?: string }).status === "failed",
    );
    expect(finalLog).toBeTruthy();
  });

  it("snapshot valido aplica tudo, reconcilia e registra stale", async () => {
    h.fetchBatch.mockResolvedValue([
      {
        entity_type: "development",
        external_id: "DEV-1",
        payload: { nome: "Dev", constructor_nome: "Construtora" },
      },
    ]);
    h.applyResult = 1;
    h.reconcile.mockResolvedValue({ staleCount: 2, errors: [] });

    const result = await runCvCrmIngest();

    expect(result).toMatchObject({
      total_records: 1,
      valid: 1,
      invalid: 0,
      processed: 1,
      stale_count: 2,
      status: "ok",
    });
    expect(h.fetchBatch).toHaveBeenCalledTimes(1);
    expect(h.fetchBatch.mock.calls[0]).toEqual(["org-config"]);
    expect(h.reconcile).toHaveBeenCalledWith("org-config", {
      development: ["DEV-1"],
      unit: [],
    });
    expect(h.rpc).toHaveBeenCalledWith(
      "fn_apply_cv_crm_valid_records",
      expect.objectContaining({ p_organization_id: "org-config" }),
    );
  });

  it("payload invalido vai ao staging como invalid e bloqueia reconciliation", async () => {
    h.fetchBatch.mockResolvedValue([
      {
        entity_type: "price_list_item",
        external_id: "PLI-BAD",
        payload: { status: "disponivel" },
      },
    ]);
    h.validationResults.push({
      data: { valid: false, errors: ["valor_cents e obrigatorio"] },
      error: null,
    });

    const result = await runCvCrmIngest();

    expect(result.status).toBe("error");
    expect(result.invalid).toBe(1);
    expect(result.processed).toBe(0);
    expect(h.reconcile).not.toHaveBeenCalled();
    expect(
      h.operations.some(
        (op) =>
          op.table === "cv_crm_staging" &&
          op.method === "upsert" &&
          (op.payload as { validation_status?: string }).validation_status === "invalid",
      ),
    ).toBe(true);
  });

  it("contagem do apply divergente falha e nao reconcilia", async () => {
    h.fetchBatch.mockResolvedValue([
      {
        entity_type: "unit",
        external_id: "UNIT-1",
        payload: {
          development_external_id: "DEV-1",
          numero: "101",
          status: "disponivel",
        },
      },
    ]);
    h.applyResult = 0;

    const result = await runCvCrmIngest();

    expect(result.status).toBe("error");
    expect(result.errors?.join(" ")).toMatch(/Aplicação inconsistente/i);
    expect(result.processed).toBe(0);
    expect(h.reconcile).not.toHaveBeenCalled();
  });

  it("erro de reconciliation torna o batch auditavelmente error", async () => {
    h.fetchBatch.mockResolvedValue([
      {
        entity_type: "development",
        external_id: "DEV-1",
        payload: { nome: "Dev", constructor_nome: "Construtora" },
      },
    ]);
    h.applyResult = 1;
    h.reconcile.mockResolvedValue({
      staleCount: 0,
      errors: ["real_estate_units: timeout"],
    });

    const result = await runCvCrmIngest();

    expect(result.status).toBe("error");
    expect(result.processed).toBe(1);
    expect(result.errors?.join(" ")).toMatch(/reconcile: real_estate_units: timeout/);
  });
});
