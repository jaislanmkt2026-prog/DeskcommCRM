import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { CV_CRM_ORG_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
}));

// Mock do módulo de auditoria antes de importar a rota
const mockAudit = vi.fn();
vi.mock("@/lib/audit", () => ({ audit: mockAudit }));

// Mock do ingest para controlar os cenários
const mockRunCvCrmIngest = vi.fn();
vi.mock("@/lib/cv-crm/ingest", () => ({ runCvCrmIngest: mockRunCvCrmIngest }));

// Mock da autorização de cron
vi.mock("@/lib/auth/cron-auth", () => ({
  autorizaCron: () => true,
}));

describe("cv-crm-audit-emit — teste focal de emissão", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudit.mockResolvedValue(undefined);
  });

  it("emite cv_crm.ingestion_completed quando status ok", async () => {
    mockRunCvCrmIngest.mockResolvedValueOnce({
      batch_id: "11111111-1111-4111-8111-111111111111",
      total_records: 10,
      valid: 10,
      invalid: 0,
      processed: 10,
      stale_count: 0,
      status: "ok",
    });

    const { GET } = await import("@/app/api/v1/cron/cv-crm-ingest/route");
    const req = new Request("http://localhost/api/v1/cron/cv-crm-ingest");
    await GET(req as any);

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const call = mockAudit.mock.calls[0]![0];
    expect(call.action).toBe("cv_crm.ingestion_completed");
    expect(call.actorUserId).toBeNull();
    expect(call.organizationId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(call.resourceType).toBe("cv_crm_ingestion");
    expect(call.resourceId).toBe("11111111-1111-4111-8111-111111111111");
    expect(call.metadata).toEqual({
      total_records: 10,
      valid: 10,
      invalid: 0,
      processed: 10,
      stale_count: 0,
      status: "ok",
    });
  });

  it("emite cv_crm.ingestion_partial quando há processamento parcial", async () => {
    mockRunCvCrmIngest.mockResolvedValueOnce({
      batch_id: "22222222-2222-4222-8222-222222222222",
      total_records: 10,
      valid: 5,
      invalid: 5,
      processed: 5,
      stale_count: 0,
      status: "error",
    });

    // Limpa o cache do módulo para reimportar
    vi.resetModules();
    const { GET } = await import("@/app/api/v1/cron/cv-crm-ingest/route");
    const req = new Request("http://localhost/api/v1/cron/cv-crm-ingest");
    await GET(req as any);

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const call = mockAudit.mock.calls[0]![0];
    expect(call.action).toBe("cv_crm.ingestion_partial");
    expect(call.metadata.total_records).toBe(10);
    expect(call.metadata.processed).toBe(5);
  });

  it("emite cv_crm.ingestion_failed quando tudo falha", async () => {
    mockRunCvCrmIngest.mockResolvedValueOnce({
      batch_id: "33333333-3333-4333-8333-333333333333",
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: ["CV_CRM_ORG_ID não configurada"],
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/v1/cron/cv-crm-ingest/route");
    const req = new Request("http://localhost/api/v1/cron/cv-crm-ingest");
    await GET(req as any);

    expect(mockAudit).toHaveBeenCalledTimes(1);
    const call = mockAudit.mock.calls[0]![0];
    expect(call.action).toBe("cv_crm.ingestion_failed");
    expect(call.metadata.status).toBe("error");
  });

  it("emite cv_crm.ingestion_failed em exceção catastrófica", async () => {
    mockRunCvCrmIngest.mockRejectedValueOnce(new Error("timeout na API externa"));

    vi.resetModules();
    const { GET } = await import("@/app/api/v1/cron/cv-crm-ingest/route");
    const req = new Request("http://localhost/api/v1/cron/cv-crm-ingest");
    const response = await GET(req as any);

    expect(response.status).toBe(500);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    const call = mockAudit.mock.calls[0]![0];
    expect(call.action).toBe("cv_crm.ingestion_failed");
    expect(call.metadata.error).toBe("timeout na API externa");
  });

  it("não inclui dados pessoais na metadata", async () => {
    mockRunCvCrmIngest.mockResolvedValueOnce({
      batch_id: "44444444-4444-4444-8444-444444444444",
      total_records: 1,
      valid: 1,
      invalid: 0,
      processed: 1,
      stale_count: 0,
      status: "ok",
    });

    vi.resetModules();
    const { GET } = await import("@/app/api/v1/cron/cv-crm-ingest/route");
    const req = new Request("http://localhost/api/v1/cron/cv-crm-ingest");
    await GET(req as any);

    const call = mockAudit.mock.calls[0]![0];
    const keys = Object.keys(call.metadata);
    // Apenas contadores e status — nenhum email, nome, telefone ou endereço
    expect(keys).not.toContain("email");
    expect(keys).not.toContain("nome");
    expect(keys).not.toContain("telefone");
    expect(keys).not.toContain("endereco");
    expect(keys.sort()).toEqual([
      "invalid",
      "processed",
      "stale_count",
      "status",
      "total_records",
      "valid",
    ]);
  });
});
