import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requirePlatformAdminEscrita } from "@/lib/auth/requirePlatformAdmin";
import { estadoParaTela, gravarPelaTela, voltarAoAmbiente } from "@/lib/instalacao/config";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  // A ação grava a configuração da instalação: o gate é o de ESCRITA do platform admin.
  requirePlatformAdminEscrita: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } })),
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } })),
}));
vi.mock("@/lib/instalacao/config", () => ({
  gravarPelaTela: vi.fn(async () => ({ ok: true })),
  voltarAoAmbiente: vi.fn(async () => ({ ok: true })),
  estadoParaTela: vi.fn(async (chave: string, ehSegredo: boolean) => ({
    chave,
    fonte: "banco",
    configurado: true,
    last4: ehSegredo ? "9f3a" : null,
    ehSegredo,
    valorVisivel: ehSegredo ? null : "valor",
  })),
}));

import { salvarConfiguracaoDaInstalacao, voltarConfiguracaoAoPadrao } from "@/app/actions/admin/salvarConfiguracaoDaInstalacao";

const USER = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformAdminEscrita).mockResolvedValue({ user: { id: USER } } as never);
  vi.mocked(gravarPelaTela).mockResolvedValue({ ok: true });
  vi.mocked(voltarAoAmbiente).mockResolvedValue({ ok: true });
});

describe("salvarConfiguracaoDaInstalacao — autonomia controlada", () => {
  it("aceita chave editável, normaliza o valor e audita a alteração", async () => {
    const r = await salvarConfiguracaoDaInstalacao("SUPPORT_EMAIL", "  suporte@example.test  ");

    expect(r.ok).toBe(true);
    expect(gravarPelaTela).toHaveBeenCalledWith("SUPPORT_EMAIL", "suporte@example.test", {
      ehSegredo: false,
      ator: USER,
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "platform.config_changed",
        actorUserId: USER,
        metadata: { chave: "SUPPORT_EMAIL", last4: undefined, natureza: "texto" },
      }),
    );
    expect(estadoParaTela).toHaveBeenCalledWith("SUPPORT_EMAIL", false);
  });

  it("rejeita valor vazio antes de persistir ou auditar", async () => {
    const r = await salvarConfiguracaoDaInstalacao("SUPPORT_EMAIL", "   ");

    expect(r.ok).toBe(false);
    expect(gravarPelaTela).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("rejeita chave desconhecida em fail-closed", async () => {
    const r = await salvarConfiguracaoDaInstalacao("CHAVE_QUE_NAO_EXISTE", "valor");

    expect(r).toEqual({ ok: false, erro: "Esta configuração não pode ser alterada por aqui." });
    expect(gravarPelaTela).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("não grava chave de diagnóstico por caminho alternativo", async () => {
    const r = await salvarConfiguracaoDaInstalacao("NEXT_PUBLIC_SUPABASE_URL", "https://example.test");

    expect(r.ok).toBe(false);
    expect(gravarPelaTela).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("fecha o ciclo alteração -> auditoria -> rollback -> estado original", async () => {
    const alterado = {
      chave: "SUPPORT_EMAIL",
      fonte: "banco" as const,
      configurado: true,
      last4: null,
      ehSegredo: false,
      valorVisivel: "alterado@example.test",
    };
    const original = {
      chave: "SUPPORT_EMAIL",
      fonte: "ambiente" as const,
      configurado: true,
      last4: null,
      ehSegredo: false,
      valorVisivel: "original@example.test",
    };
    vi.mocked(estadoParaTela).mockResolvedValueOnce(alterado).mockResolvedValueOnce(original);

    const salvo = await salvarConfiguracaoDaInstalacao("SUPPORT_EMAIL", "alterado@example.test");
    expect(salvo).toEqual({ ok: true, estado: alterado });

    const restaurado = await voltarConfiguracaoAoPadrao("SUPPORT_EMAIL");
    expect(voltarAoAmbiente).toHaveBeenCalledWith("SUPPORT_EMAIL");
    expect(restaurado).toEqual({ ok: true, estado: original });
    expect(audit).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: "platform.config_changed", metadata: expect.objectContaining({ chave: "SUPPORT_EMAIL" }) }),
    );
    expect(audit).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: "platform.config_reset", metadata: { chave: "SUPPORT_EMAIL" } }),
    );
  });

  it("segredo entra na escrita, mas o audit recebe somente chave, natureza e last4", async () => {
    const segredo = "re_teste_super_secreto_9f3a";
    const r = await salvarConfiguracaoDaInstalacao("RESEND_API_KEY", segredo);

    expect(r.ok).toBe(true);
    expect(gravarPelaTela).toHaveBeenCalledWith("RESEND_API_KEY", segredo, {
      ehSegredo: true,
      ator: USER,
    });

    const chamada = vi.mocked(audit).mock.calls[0]?.[0];
    expect(chamada).toEqual(
      expect.objectContaining({
        action: "platform.config_changed",
        metadata: { chave: "RESEND_API_KEY", last4: "9f3a", natureza: "segredo" },
      }),
    );
    expect(JSON.stringify(chamada)).not.toContain(segredo);
  });
});
