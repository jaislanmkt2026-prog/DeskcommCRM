import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarCrivoUpstream } from "@/lib/system/upstream-monitor";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/system/upstream-monitor", () => ({ executarCrivoUpstream: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("/api/v1/system/upstream", () => {
  it("tenant admin sem autoridade de plataforma recebe 403 antes do service role", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue({ id: "u", is_platform_admin: false } as never);
    const { GET } = await import("@/app/api/v1/system/upstream/route");
    const response = await GET();
    expect(response.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["merge", "apply", "update"])("não aceita ação destrutiva %s", async (action) => {
    vi.mocked(loadAuthUser).mockResolvedValue({ id: "owner", is_platform_admin: true } as never);
    const { POST } = await import("@/app/api/v1/system/upstream/route");
    const response = await POST(
      new NextRequest("http://localhost/api/v1/system/upstream", {
        method: "POST",
        body: JSON.stringify({ action }),
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
    expect(executarCrivoUpstream).not.toHaveBeenCalled();
  });
});


function adminParaApprove(options?: { analysisStatus?: string; approvalRow?: { id: number } | null }) {
  const state = {
    crivo_environment: "production",
    kill_switch: false,
    change_fingerprint: "a".repeat(64),
    analysis_status: options?.analysisStatus ?? "completed",
  };
  return {
    from(table: string) {
      type MockQuery = {
        __updated?: boolean;
        select: () => MockQuery;
        eq: () => MockQuery;
        update: () => MockQuery;
        order: () => MockQuery;
        limit: () => MockQuery;
        maybeSingle: () => Promise<{ data: unknown; error: null }>;
      };
      const query = {} as MockQuery;
      query.select = () => query;
      query.eq = () => query;
      query.update = () => {
        query.__updated = true;
        return query;
      };
      query.order = () => query;
      query.limit = () => query;
      query.maybeSingle = async () => ({
        data: table === "system_upstream_state" && query.__updated
          ? (options?.approvalRow === undefined ? { id: 1 } : options.approvalRow)
          : table === "system_upstream_state" ? state : null,
        error: null,
      });
      return query;
    },
  };
}

describe("approval gate da Missão 7.6", () => {
  beforeEach(() => {
    vi.stubEnv("CRIVO_ENVIRONMENT", "production");
    vi.mocked(loadAuthUser).mockResolvedValue({ id: "owner", is_platform_admin: true } as never);
  });

  it("recusa aprovação quando a análise ainda não terminou", async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminParaApprove({ analysisStatus: "incomplete" }) as never);
    const { POST } = await import("@/app/api/v1/system/upstream/route");
    const response = await POST(new NextRequest("http://localhost/api/v1/system/upstream", {
      method: "POST",
      body: JSON.stringify({ action: "approve" }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toContain("análise do Crivo precisa estar completa");
  });

  it("não responde sucesso se o fingerprint mudar durante a aprovação", async () => {
    vi.mocked(createAdminClient).mockReturnValue(adminParaApprove({ approvalRow: null }) as never);
    const { POST } = await import("@/app/api/v1/system/upstream/route");
    const response = await POST(new NextRequest("http://localhost/api/v1/system/upstream", {
      method: "POST",
      body: JSON.stringify({ action: "approve" }),
      headers: { "content-type": "application/json" },
    }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.message).toContain("mudou");
  });
});
