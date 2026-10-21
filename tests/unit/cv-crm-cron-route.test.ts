import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  autoriza: vi.fn(),
  ingest: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/auth/cron-auth", () => ({
  autorizaCron: h.autoriza,
}));

vi.mock("@/lib/cv-crm/ingest", () => ({
  runCvCrmIngest: h.ingest,
}));

vi.mock("@/lib/audit", () => ({ audit: h.audit }));

vi.mock("@/lib/env", () => ({
  env: { CV_CRM_ORG_ID: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
}));

import { GET } from "@/app/api/v1/cron/cv-crm-ingest/route";

describe("cron CV CRM", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.autoriza.mockReturnValue(true);
    h.audit.mockResolvedValue(undefined);
  });

  it("retorna 401 quando cron nao esta autorizado", async () => {
    h.autoriza.mockReturnValue(false);

    const response = await GET({} as never);

    expect(response.status).toBe(401);
    expect(h.ingest).not.toHaveBeenCalled();
  });

  it("propaga falha interna da ingestao como HTTP 500", async () => {
    h.ingest.mockResolvedValue({
      batch_id: "b1",
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: ["fonte indisponivel"],
    });

    const response = await GET({} as never);

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ status: "error" });
  });

  it("retorna 200 somente quando a ingestao termina ok", async () => {
    h.ingest.mockResolvedValue({
      batch_id: "b2",
      total_records: 1,
      valid: 1,
      invalid: 0,
      processed: 1,
      stale_count: 0,
      status: "ok",
    });

    const response = await GET({} as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", processed: 1 });
    expect(h.ingest).toHaveBeenCalledWith({
      orgId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      batchSize: 1000,
    });
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }),
    );
  });
});
