import { describe, test, expect } from "vitest";
import {
  aplicarGuardrailLiaOutbound,
  detectarAfirmacaoPrecoImovel,
  LIA_PRICE_FAILSAFE,
} from "@/lib/agent-engine/guardrails/lia-outbound-guard";

describe("Lia Outbound Guard (Missão 5D)", () => {
  describe("1. Escopo e Envio Humano", () => {
    test("mensagem humana (actorType: user) NÃO é alterada", () => {
      const msgHumana = "Olá Carlos! O preço do imóvel é R$ 450.000 e meu CPF é 123.456.789-00";
      const result = aplicarGuardrailLiaOutbound(msgHumana, { actorType: "user" });
      expect(result.body).toBe(msgHumana);
      expect(result.sanitized).toBe(false);
      expect(result.blocked).toBe(false);
    });

    test("mensagem com isAiAgent: false NÃO é alterada", () => {
      const msg = "Mensagem do corretor com R$ 300.000";
      const result = aplicarGuardrailLiaOutbound(msg, { isAiAgent: false });
      expect(result.body).toBe(msg);
      expect(result.sanitized).toBe(false);
    });
  });

  describe("2. Redaction de PII (IA Outbound)", () => {
    test("mascara CPF em resposta da IA", () => {
      const msg = "O cadastro com CPF 123.456.789-00 foi localizado.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.body).toContain("[CPF REDACTED]");
      expect(result.body).not.toContain("123.456.789-00");
    });

    test("mascara RG em resposta da IA", () => {
      const msg = "Recebi seu RG 12.345.678-9 para conferência.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.body).toContain("[RG REDACTED]");
      expect(result.body).not.toContain("12.345.678-9");
    });

    test("mascara Telefone em resposta da IA", () => {
      const msg = "Vou ligar no número (82) 99887-6655 em instantes.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.body).toContain("[PHONE REDACTED]");
      expect(result.body).not.toContain("(82) 99887-6655");
    });

    test("mascara E-mail em resposta da IA", () => {
      const msg = "Enviei os detalhes para cliente.teste@gmail.com";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.body).toContain("[EMAIL REDACTED]");
      expect(result.body).not.toContain("cliente.teste@gmail.com");
    });
  });

  describe("3. Bloqueio de Vazamento de Vocabulário Interno", () => {
    test("bloqueia nome de tool interna (ex: crm_get_lead)", () => {
      const msg = "Vou executar a tool crm_get_lead para ver seu perfil.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain("lia_guardrail_vazamento_interno");
      expect(result.blockReason).toContain("tool");
    });

    test("bloqueia token interno dsk_ ou arquitetura webhook", () => {
      const msg = "O seu webhook interno está configurado.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.blocked).toBe(true);
      expect(result.blockReason).toContain("arquitetura");
    });
  });

  describe("4. Gate Determinístico de Preço de Imóvel vs Dados do Cliente", () => {
    test("NÃO bloqueia renda informada pelo cliente (R$ 8.500)", () => {
      const msg = "Entendido, Carlos! Anotei aqui sua renda de R$ 8.500 para análise.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.priceGateTriggered).toBe(false);
      expect(result.priceGatePassed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.body).toBe(msg);
    });

    test("NÃO bloqueia orçamento máximo informado pelo cliente (R$ 500 mil)", () => {
      const msg = "Perfeito! Vamos buscar opções no seu orçamento de até R$ 500 mil.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.priceGateTriggered).toBe(false);
      expect(result.priceGatePassed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.body).toBe(msg);
    });

    test("NÃO bloqueia entrada disponível declarada pelo cliente (R$ 50 mil)", () => {
      const msg = "Anotado: você tem R$ 50 mil para entrada.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.priceGateTriggered).toBe(false);
      expect(result.priceGatePassed).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.body).toBe(msg);
    });

    test("BLOQUEIA preço de imóvel sem receipt oficial e aplica fail-safe", () => {
      const msg = "O valor da unidade 101 é R$ 450.000.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [], // Sem receipt
      });
      expect(result.priceGateTriggered).toBe(true);
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });

    test("PERMITE preço de imóvel quando houver receipt oficial válido de crm_get_unit_price", () => {
      const msg = "O valor da unidade 101 é R$ 450.000.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: { price: { valor_cents: 45000000 } },
          },
        ],
      });
      expect(result.priceGateTriggered).toBe(true);
      expect(result.priceGatePassed).toBe(true);
      expect(result.body).toBe(msg);
    });

    test("FAIL-CLOSED quando o valor dito diverge do receipt oficial", () => {
      const msg = "O valor da unidade 101 é R$ 499.000.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: { price: { valor_cents: 45000000 } },
          },
        ],
      });
      expect(result.priceGateTriggered).toBe(true);
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });

    test("FAIL-CLOSED para sinal sem sinal_cents oficial no receipt", () => {
      const msg = "O valor é R$ 450.000 com sinal de R$ 45.000.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: { price: { valor_cents: 45000000 } },
          },
        ],
      });
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });

    test("PERMITE sinal quando valor e sinal coincidem com o receipt", () => {
      const msg = "O valor é R$ 450.000 com sinal de R$ 45.000.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: {
              price: {
                valor_cents: 45000000,
                sinal_cents: 4500000,
              },
            },
          },
        ],
      });
      expect(result.priceGatePassed).toBe(true);
      expect(result.body).toBe(msg);
    });

    test("FAIL-CLOSED para parcelas sem estrutura oficial no receipt", () => {
      const msg = "O valor é R$ 450.000 com 60 parcelas de R$ 1.500.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: { price: { valor_cents: 45000000 } },
          },
        ],
      });
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });

    test("PERMITE parcelas quando quantidade e valor estão comprovados no receipt", () => {
      const msg = "O valor é R$ 450.000 com 60 parcelas de R$ 1.500.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: {
              price: {
                valor_cents: 45000000,
                parcelas: { quantidade: 60, valor_cents: 150000 },
              },
            },
          },
        ],
      });
      expect(result.priceGatePassed).toBe(true);
      expect(result.body).toBe(msg);
    });

    test("FAIL-CLOSED para condições comerciais sem condicoes_chaves oficial", () => {
      const msg = "O valor é R$ 450.000, com condições de chaves conforme tabela.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: { price: { valor_cents: 45000000 } },
          },
        ],
      });
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });


    test("NAO bloqueia financiamento informado como intencao do cliente", () => {
      const msg = "Anotado: voce pretende financiar R$ 200 mil.";
      const result = aplicarGuardrailLiaOutbound(msg, { actorType: "ai_agent" });
      expect(result.priceGateTriggered).toBe(false);
      expect(result.priceGatePassed).toBe(true);
      expect(result.body).toBe(msg);
    });

    test("FAIL-CLOSED para valor de financiamento sem financiamento oficial", () => {
      const msg = "O valor de R$ 450.000, com financiamento de R$ 207.920.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: { price: { valor_cents: 45000000 } },
          },
        ],
      });
      expect(result.priceGateTriggered).toBe(true);
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });

    test("PERMITE financiamento quando valor coincide com o receipt oficial", () => {
      const msg = "O valor de R$ 450.000, com financiamento de R$ 207.920.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: {
              price: {
                valor_cents: 45000000,
                financiamento: "R$ 207.920,00",
              },
            },
          },
        ],
      });
      expect(result.priceGateTriggered).toBe(true);
      expect(result.priceGatePassed).toBe(true);
      expect(result.body).toBe(msg);
    });

    test("FAIL-CLOSED para mencao de financiamento sem dado oficial", () => {
      const msg = "Ha financiamento disponivel para esta unidade.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: { price: { valor_cents: 45000000 } },
          },
        ],
      });
      expect(result.priceGateTriggered).toBe(true);
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });

    test("FAIL-CLOSED quando financiamento dito diverge do receipt oficial", () => {
      const msg = "O valor de R$ 450.000, com financiamento de R$ 207.920.";
      const result = aplicarGuardrailLiaOutbound(msg, {
        actorType: "ai_agent",
        toolReceipts: [
          {
            toolName: "crm_get_unit_price",
            ok: true,
            data: {
              price: {
                valor_cents: 45000000,
                financiamento: "R$ 200.000,00",
              },
            },
          },
        ],
      });
      expect(result.priceGatePassed).toBe(false);
      expect(result.body).toBe(LIA_PRICE_FAILSAFE);
    });
  });
});
