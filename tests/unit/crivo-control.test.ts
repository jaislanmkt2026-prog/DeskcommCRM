import { describe, expect, it } from "vitest";

import {
  crivoCapabilities,
  fingerprintCrivoChange,
  hasValidCrivoApproval,
  resolveCrivoEnvironment,
  sanitizeCrivoText,
} from "@/lib/system/crivo-control";

describe("Crivo 7.6 — controle de ambiente, capabilities e aprovação", () => {
  it("gate 1: reconhece local", () => {
    expect(resolveCrivoEnvironment({ CRIVO_ENVIRONMENT: "local" })).toEqual({ ok: true, environment: "local" });
  });

  it("gate 2: reconhece staging", () => {
    expect(resolveCrivoEnvironment({ CRIVO_ENVIRONMENT: "staging" })).toEqual({ ok: true, environment: "staging" });
  });

  it("gate 3: reconhece production", () => {
    expect(resolveCrivoEnvironment({ CRIVO_ENVIRONMENT: "production" })).toEqual({ ok: true, environment: "production" });
  });

  it("gate 4: ambiente ausente ou ambíguo/inválido falha fechado", () => {
    const missing = resolveCrivoEnvironment({});
    const invalid = resolveCrivoEnvironment({ CRIVO_ENVIRONMENT: "production,staging" });
    expect(missing.ok).toBe(false);
    expect(invalid.ok).toBe(false);
    expect(crivoCapabilities(missing, false)).toMatchObject({
      read: true,
      analyze: true,
      sandbox: false,
      validate: false,
      prepare_apply: false,
      apply_production: false,
    });
  });

  it("gate 5: segredo não aparece em texto sanitizado", () => {
    const result = sanitizeCrivoText(new Error("token=abc123 secret:xyz cookie=qwe https://example.test/private"));
    expect(result).not.toContain("abc123");
    expect(result).not.toContain("xyz");
    expect(result).not.toContain("qwe");
    expect(result).not.toContain("example.test");
    expect(result).toContain("[redacted]");
  });

  it("gates 7-9: aprovação é específica, determinística e one-shot", () => {
    const fingerprint = fingerprintCrivoChange({
      forkCommit: "a".repeat(40),
      upstreamCommit: "b".repeat(40),
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
    });
    expect(fingerprint).toBe(
      fingerprintCrivoChange({
        forkCommit: "a".repeat(40),
        upstreamCommit: "b".repeat(40),
        fromVersion: "1.0.0",
        toVersion: "1.1.0",
      }),
    );
    expect(hasValidCrivoApproval(null, fingerprint)).toBe(false);
    expect(
      hasValidCrivoApproval(
        { fingerprint, approvedBy: "owner", approvedAt: "2026-09-28T12:00:00.000Z", consumedAt: null },
        fingerprint,
      ),
    ).toBe(true);
    expect(
      hasValidCrivoApproval(
        { fingerprint, approvedBy: "owner", approvedAt: "2026-09-28T12:00:00.000Z", consumedAt: null },
        fingerprintCrivoChange({ forkCommit: "a".repeat(40), upstreamCommit: "c".repeat(40), fromVersion: "1.0.0", toVersion: "1.1.0" }),
      ),
    ).toBe(false);
    expect(
      hasValidCrivoApproval(
        { fingerprint, approvedBy: "owner", approvedAt: "2026-09-28T12:00:00.000Z", consumedAt: "2026-09-28T12:01:00.000Z" },
        fingerprint,
      ),
    ).toBe(false);
  });

  it("gate 10: kill switch bloqueia execução e preparação, preservando leitura/análise", () => {
    const staging = resolveCrivoEnvironment({ CRIVO_ENVIRONMENT: "staging" });
    expect(crivoCapabilities(staging, true)).toEqual({
      read: true,
      analyze: true,
      sandbox: false,
      validate: false,
      prepare_apply: false,
      apply_production: false,
    });
  });
});
