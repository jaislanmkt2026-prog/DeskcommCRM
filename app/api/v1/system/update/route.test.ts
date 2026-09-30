import { NextRequest } from "next/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  rpcData: "11111111-1111-4111-8111-111111111111" as string | null,
  rpcError: null as { code: string; message: string } | null,
  audit: vi.fn(),
  state: {
    crivo_environment: "staging",
    kill_switch: false,
    change_fingerprint: "a".repeat(64),
  },
}));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: async () => null }));
vi.mock("@/lib/auth/server", () => ({
  loadAuthUser: async () => ({ id: "owner", is_platform_admin: true }),
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        limit: () => query,
        update: () => query,
        maybeSingle: async () => ({
          data:
            table === "system_version"
              ? { current_version: "1.0.0", latest_version: "1.1.0" }
              : table === "system_upstream_state"
                ? mocks.state
                : null,
          error: null,
        }),
      };
      return query;
    },
  }),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CRIVO_ENVIRONMENT", "staging");
  mocks.state = { crivo_environment: "staging", kill_switch: false, change_fingerprint: "a".repeat(64) };
  mocks.rpcData = "11111111-1111-4111-8111-111111111111";
  mocks.rpcError = null;
  mocks.rpc.mockImplementation(async () => ({ data: mocks.rpcData, error: mocks.rpcError }));
});

it("explica a preparação de extensão que bloqueia a atualização sem despachar um run", async () => {
  mocks.rpcError = { code: "P0001", message: "extension_preparation_in_progress" };
  const response = await POST(new NextRequest("http://localhost/api/v1/system/update", { method: "POST" }));
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body.error.code).toBe("state_conflict");
  expect(body.error.message).toContain("Abra Extensões");
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("a recusa nomeia as duas saídas da preparação: quem pediu retoma, qualquer responsável cancela", async () => {
  mocks.rpcError = { code: "P0001", message: "extension_preparation_in_progress" };
  const response = await POST(new NextRequest("http://localhost/api/v1/system/update", { method: "POST" }));
  const { error } = await response.json();
  expect(error.message).toContain("Atividade recente");
  expect(error.message).toContain("quem pediu pode retomar o pedido");
  expect(error.message).toContain("qualquer responsável pela instalação pode cancelá-lo");
});

it("não disfarça falha de infraestrutura como conflito de extensão", async () => {
  mocks.rpcError = { code: "08006", message: "connection failed" };
  const response = await POST(new NextRequest("http://localhost/api/v1/system/update", { method: "POST" }));
  expect(response.status).toBe(500);
  expect((await response.json()).error.message).not.toContain("Abra Extensões");
});

it("gate 7/18: produção sem aprovação específica é bloqueada", async () => {
  vi.stubEnv("CRIVO_ENVIRONMENT", "production");
  mocks.state = { crivo_environment: "production", kill_switch: false, change_fingerprint: "b".repeat(64) };
  mocks.rpcError = { code: "P0001", message: "crivo_approval_required" };
  const response = await POST(new NextRequest("http://localhost/api/v1/system/update", { method: "POST" }));
  expect(response.status).toBe(409);
  expect((await response.json()).error.message).toContain("Produção exige aprovação específica");
});


it("gate: análise incompleta é recusada pelo despacho transacional", async () => {
  mocks.rpcError = { code: "P0001", message: "crivo_analysis_incomplete" };
  const response = await POST(new NextRequest("http://localhost/api/v1/system/update", { method: "POST" }));
  expect(response.status).toBe(409);
  expect((await response.json()).error.message).toContain("análise do Crivo precisa estar completa");
  expect(mocks.audit).not.toHaveBeenCalled();
});

it("gate 17: staging despacha somente pela RPC controlada", async () => {
  const response = await POST(new NextRequest("http://localhost/api/v1/system/update", { method: "POST" }));
  expect(response.status).toBe(200);
  expect(mocks.rpc).toHaveBeenCalledWith("fn_crivo_dispatch_update", expect.objectContaining({
    p_environment: "staging",
    p_fingerprint: "a".repeat(64),
  }));
  expect(mocks.audit).toHaveBeenCalled();
});
