import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

vi.mock("@/lib/auth/server", () => ({ loadAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const OWN_ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

function authUser(platformAdmin = false) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "operador@example.test",
    full_name: "Operador",
    avatar_url: null,
    is_platform_admin: platformAdmin,
    platform_admin_scope: platformAdmin ? "full" : null,
    idioma: "pt-BR",
    organizations: [
      {
        organization_id: OWN_ORG,
        organization_name: "Tenant próprio",
        role: "admin",
        org_status: "active",
      },
    ],
  } as never;
}

function query(result: Record<string, unknown>) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "order", "limit", "eq", "gte", "lte", "not"]) {
    chain[method] = () => chain;
  }
  chain.then = (
    onFulfilled: (value: Record<string, unknown>) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(onFulfilled, onRejected);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAdminClient).mockReturnValue({
    from: (table: string) => {
      if (table === "cv_crm_ingestion_logs") return query({ data: [], error: null });
      if (table === "real_estate_developments" || table === "real_estate_units") {
        return query({ data: [], count: 0, error: null });
      }
      throw new Error("Tabela inesperada no teste: " + table);
    },
  } as never);
});

async function logs(queryString = "") {
  const { GET } = await import("../../app/api/v1/system/cv-crm/logs/route");
  return GET(new NextRequest("http://localhost/api/v1/system/cv-crm/logs" + queryString));
}

async function metrics(queryString = "") {
  const { GET } = await import("../../app/api/v1/system/cv-crm/metrics/route");
  return GET(new NextRequest("http://localhost/api/v1/system/cv-crm/metrics" + queryString));
}

describe.each([
  ["logs", logs],
  ["metrics", metrics],
] as const)("CV CRM system %s tenant authorization", (_name, callRoute) => {
  it("responde 401 sem autenticação", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(null);
    expect((await callRoute("?orgId=" + OWN_ORG)).status).toBe(401);
  });

  it("responde 403 para usuário comum sem orgId", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(authUser(false));
    expect((await callRoute()).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("permite usuário comum consultar a própria organização", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(authUser(false));
    expect((await callRoute("?orgId=" + OWN_ORG)).status).toBe(200);
    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: OWN_ORG,
        actingAsPlatformAdmin: false,
      }),
    );
  });

  it("bloqueia usuário comum ao informar organização de terceiro", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(authUser(false));
    expect((await callRoute("?orgId=" + OTHER_ORG)).status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("permite platform admin consultar visão global", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(authUser(true));
    expect((await callRoute()).status).toBe(200);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: undefined,
        actingAsPlatformAdmin: true,
      }),
    );
  });

  it("permite platform admin filtrar organização arbitrária", async () => {
    vi.mocked(loadAuthUser).mockResolvedValue(authUser(true));
    expect((await callRoute("?orgId=" + OTHER_ORG)).status).toBe(200);
  });
});
