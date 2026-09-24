import { describe, test, expect } from "vitest";
import {
  redactCPF,
  redactRG,
  redactPhone,
  redactEmail,
  redactSensitive,
} from "@/lib/agent-engine/guardrails/redact-pii";
import { detectarVazamentoInterno } from "@/lib/agent-engine/guardrails/vazamento-interno";

describe("Guardrail 1: Redaction PII", () => {
  test("redactCPF mascara CPF com pontos e traço", () => {
    expect(redactCPF("CPF 123.456.789-00")).toBe("CPF [CPF REDACTED]");
  });

  test("redactCPF mascara CPF sem formatação (11 dígitos)", () => {
    expect(redactCPF("12345678900")).toBe("[CPF REDACTED]");
  });

  test("redactRG mascara RG com pontos e traço", () => {
    expect(redactRG("RG 12.345.678-9")).toBe("RG [RG REDACTED]");
  });

  test("redactRG mascara RG sem primeiro dígito", () => {
    expect(redactRG("1.234.567")).toBe("[RG REDACTED]");
  });

  test("redactPhone mascara telefone com DDD", () => {
    expect(redactPhone("(11) 98765-4321")).toBe("[PHONE REDACTED]");
  });

  test("redactEmail mascara e-mail válido", () => {
    expect(redactEmail("contato@empresa.com")).toBe("[EMAIL REDACTED]");
  });

  test("redactSensitive aplica todas as máscaras em ordem", () => {
    const texto = "Meu CPF é 123.456.789-00 e email teste@test.com";
    expect(redactSensitive(texto)).toBe("Meu CPF é [CPF REDACTED] e email [EMAIL REDACTED]");
  });
});

describe("Guardrail 2: Vazamento Interno", () => {
  test("banir token dsk_ como snake_case", () => {
    const r = detectarVazamentoInterno("use o token dsk_abc123xyz");
    expect(r.achou).toBe(true);
    expect(r.categorias).toContain("snake_case");
  });

  test("banir nome de tool crm_get_lead", () => {
    const r = detectarVazamentoInterno("vou chamar crm_get_lead para buscar");
    expect(r.achou).toBe(true);
    expect(r.categorias).toContain("tool");
  });

  test("banir arquitetura webhook", () => {
    const r = detectarVazamentoInterno("nenhum webhook configurado");
    expect(r.achou).toBe(true);
    expect(r.categorias).toContain("arquitetura");
  });
});
