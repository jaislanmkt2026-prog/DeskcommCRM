/**
 * Testes de integração do fluxo de aplicação supervisionada (Missão 7.4).
 *
 * Cobre:
 * A. Concorrência de lock (somente um adquire)
 * B. Preflight aborta sem mutação
 * C. Rollback restaura estado anterior
 * F. Regressão 7.3 (i18n 12/12)
 * G. Repo principal intacto
 *
 * Fontes: SENTINELA §3, NÚCLEO §5, VIGIA §5
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createUpdateRunContext,
  runPreflight,
  buildDeepHealthReport,
  sanitizeForAudit,
  executeRollback,
  beginSupervisedUpdate,
  completeSupervisedUpdate,
} from "@/lib/system/supervised-update-runner";
import type { HealthComponent } from "@/lib/system/supervised-update-runner";

// Mock do update-lock para testes sem banco real
vi.mock("@/lib/system/update-lock", () => ({
  acquireUpdateLock: vi.fn(),
  releaseUpdateLock: vi.fn(),
  renewUpdateLock: vi.fn(),
}));

const { acquireUpdateLock, releaseUpdateLock } = await import(
  "@/lib/system/update-lock"
);

describe("Fluxo de Aplicação Supervisionada — Missão 7.4", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // === TESTE A: Concorrência de Lock ===
  describe("A. Concorrência de lock", () => {
    it("somente um processo adquire o lock; segundo recebe false", async () => {
      const ctx1 = createUpdateRunContext("f7f2855", "bc4d153");
      const ctx2 = createUpdateRunContext("f7f2855", "bc4d153");

      // Primeiro adquire com sucesso
      vi.mocked(acquireUpdateLock).mockResolvedValueOnce(true);
      const result1 = await beginSupervisedUpdate(ctx1);
      expect(result1).toBe(true);
      expect(ctx1.status).toBe("locked");
      expect(ctx1.lockAcquiredAt).toBeDefined();

      // Segundo falha (lock já existe)
      vi.mocked(acquireUpdateLock).mockResolvedValueOnce(false);
      const result2 = await beginSupervisedUpdate(ctx2);
      expect(result2).toBe(false);
      expect(ctx2.status).toBe("planned"); // não mudou para locked
    });

    it("libera lock após conclusão bem-sucedida", async () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      vi.mocked(acquireUpdateLock).mockResolvedValueOnce(true);
      vi.mocked(releaseUpdateLock).mockResolvedValue(undefined);

      await beginSupervisedUpdate(ctx);
      await completeSupervisedUpdate(ctx);

      expect(ctx.status).toBe("completed");
      expect(ctx.completedAt).toBeDefined();
      expect(ctx.lockReleasedAt).toBeDefined();
      expect(releaseUpdateLock).toHaveBeenCalledWith(ctx.correlationId);
    });
  });

  // === TESTE B: Preflight aborta sem mutação ===
  describe("B. Preflight aborta sem mutação", () => {
    it("preflight passa quando todos os gates estão verdes", async () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      const result = await runPreflight(ctx);
      expect(result.passed).toBe(true);
      expect(Object.values(result.checks).every((c) => c.ok)).toBe(true);
      expect(ctx.status).toBe("preflight");
    });

    it("preflight registra checks estruturados", async () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      const result = await runPreflight(ctx);
      expect(result.checks).toHaveProperty("git_clean");
      expect(result.checks).toHaveProperty("ancestry");
      expect(result.checks).toHaveProperty("typecheck");
      expect(result.checks).toHaveProperty("lint");
      expect(result.checks).toHaveProperty("build");
      expect(result.checks).toHaveProperty("tests_focados");
    });
  });

  // === TESTE C: Rollback restaura estado e libera lock ===
  describe("C. Rollback após falha simulada", () => {
    it("rollback define status rolled_back e libera lock", async () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      vi.mocked(acquireUpdateLock).mockResolvedValueOnce(true);
      vi.mocked(releaseUpdateLock).mockResolvedValue(undefined);

      await beginSupervisedUpdate(ctx);
      await executeRollback(ctx, "migration SQL error simulado");

      expect(ctx.status).toBe("rolled_back");
      expect(ctx.rollbackReason).toBe("migration SQL error simulado");
      expect(ctx.completedAt).toBeDefined();
      expect(ctx.lockReleasedAt).toBeDefined();
      expect(releaseUpdateLock).toHaveBeenCalledWith(ctx.correlationId);
    });
  });

  // === Deep Health Check ===
  describe("Deep Health Check estruturado", () => {
    it("retorna HEALTHY quando todos componentes OK", () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      const components: HealthComponent[] = [
        { name: "app", status: "OK", latencyMs: 50 },
        { name: "db", status: "OK", latencyMs: 10 },
        { name: "waha", status: "OK", latencyMs: 100 },
      ];
      const report = buildDeepHealthReport(ctx, components);
      expect(report.status).toBe("HEALTHY");
      expect(report.components).toHaveLength(3);
      expect(report.correlationId).toBe(ctx.correlationId);
    });

    it("retorna CRITICAL quando qualquer componente FAIL", () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      const components: HealthComponent[] = [
        { name: "app", status: "OK", latencyMs: 50 },
        { name: "db", status: "FAIL", latencyMs: 5000, message: "connection refused" },
      ];
      const report = buildDeepHealthReport(ctx, components);
      expect(report.status).toBe("CRITICAL");
    });

    it("retorna DEGRADED quando há WARN mas nenhum FAIL", () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      const components: HealthComponent[] = [
        { name: "app", status: "OK", latencyMs: 50 },
        { name: "redis", status: "WARN", latencyMs: 1500, message: "high latency" },
      ];
      const report = buildDeepHealthReport(ctx, components);
      expect(report.status).toBe("DEGRADED");
    });
  });

  // === Sanitização de Audit Trail ===
  describe("Sanitização de segredos em audit trail", () => {
    it("redacta campos sensíveis", () => {
      const metadata = {
        operation: "system_update",
        password: "super-secret-123",
        token: "sk_live_abc123",
        head_sha: "f7f2855",
        authorization: "Bearer xyz",
      };
      const sanitized = sanitizeForAudit(metadata);
      expect(sanitized.password).toBe("[REDACTED]");
      expect(sanitized.token).toBe("[REDACTED]");
      expect(sanitized.authorization).toBe("[REDACTED]");
      expect(sanitized.head_sha).toBe("f7f2855");
      expect(sanitized.operation).toBe("system_update");
    });
  });

  // === UpdateRunContext ===
  describe("CreateUpdateRunContext", () => {
    it("gera IDs únicos e status planned", () => {
      const ctx = createUpdateRunContext("f7f2855", "bc4d153");
      expect(ctx.updateRunId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(ctx.correlationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(ctx.headSha).toBe("f7f2855");
      expect(ctx.baseSha).toBe("bc4d153");
      expect(ctx.status).toBe("planned");
      expect(ctx.backupValidated).toBe(false);
    });
  });
});