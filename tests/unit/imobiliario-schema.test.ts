import { describe, it, expect } from "vitest";
import {
  qualificacaoImobiliariaSchema,
  validarFaixaValor,
  mergeQualificacaoParcial,
} from "@/lib/schemas/imobiliario";

describe("qualificacao_imobiliaria schema", () => {
  const payloadValido = {
    finalidade: "investimento_aluguel" as const,
    tipo_imovel: "apartamento" as const,
    faixa_valor_min_cents: 25000000,
    faixa_valor_max_cents: 40000000,
    quartos_desejados: 2,
    garagem_necessaria: true,
    preferencias: ["varanda_gourmet", "piscina"],
    observacoes_comerciais: "Cliente prefere andar alto",
    estagio_qualificacao: "inicial" as const,
    ultima_atualizacao: new Date().toISOString(),
  };

  it("aceita payload válido completo", () => {
    const result = qualificacaoImobiliariaSchema.safeParse(payloadValido);
    expect(result.success).toBe(true);
  });

  it("rejeita finalidade inválida", () => {
    const invalido = { ...payloadValido, finalidade: "invalido" };
    const result = qualificacaoImobiliariaSchema.safeParse(invalido);
    expect(result.success).toBe(false);
  });

  it("rejeita faixa de valor incoerente (min > max)", () => {
    const incoerente = {
      ...payloadValido,
      faixa_valor_min_cents: 50000000,
      faixa_valor_max_cents: 30000000,
    };
    const faixaResult = validarFaixaValor(incoerente);
    expect(faixaResult.ok).toBe(false);
    expect(faixaResult.error).toContain("faixa_valor_min_cents");
  });

  it("aceita campos opcionais ausentes", () => {
    const minimo = {
      finalidade: "moradia_proprio" as const,
      tipo_imovel: "casa_terrea" as const,
      estagio_qualificacao: "documentacao_pendente" as const,
      ultima_atualizacao: new Date().toISOString(),
    };
    const result = qualificacaoImobiliariaSchema.safeParse(minimo);
    expect(result.success).toBe(true);
  });

  it("rejeita observacoes_comerciais muito longas", () => {
    const longo = {
      ...payloadValido,
      observacoes_comerciais: "x".repeat(2001),
    };
    const result = qualificacaoImobiliariaSchema.safeParse(longo);
    expect(result.success).toBe(false);
  });
});

describe("mergeQualificacaoParcial", () => {
  it("preserva chaves existentes e atualiza patch", () => {
    const existing = {
      qualificacao_imobiliaria: {
        finalidade: "moradia_proprio",
        tipo_imovel: "apartamento",
        estagio_qualificacao: "inicial",
        ultima_atualizacao: "2026-01-01T00:00:00.000Z",
      },
    };
    const patch = {
      estagio_qualificacao: "documentacao_completa" as const,
    };
    const merged = mergeQualificacaoParcial(existing, patch);
    expect(merged.finalidade).toBe("moradia_proprio");
    expect(merged.estagio_qualificacao).toBe("documentacao_completa");
    expect(merged.ultima_atualizacao).not.toBe("2026-01-01T00:00:00.000Z");
  });

  it("lança erro se patch for inválido", () => {
    const existing = {};
    const patchInvalido = {
      estagio_qualificacao: "invalido",
    };
    expect(() => mergeQualificacaoParcial(existing, patchInvalido as any)).toThrow();
  });

  it("lança erro se faixa de valor for incoerente", () => {
    const existing = {};
    const patchIncoerente = {
      finalidade: "investimento_aluguel",
      tipo_imovel: "apartamento",
      estagio_qualificacao: "inicial",
      ultima_atualizacao: new Date().toISOString(),
      faixa_valor_min_cents: 50000000,
      faixa_valor_max_cents: 30000000,
    };
    expect(() => mergeQualificacaoParcial(existing, patchIncoerente)).toThrow(
      "faixa_valor_min_cents",
    );
  });
});
