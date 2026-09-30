import { createHash } from "node:crypto";

export const CRIVO_ENVIRONMENTS = ["local", "staging", "production"] as const;
export type CrivoEnvironment = (typeof CRIVO_ENVIRONMENTS)[number];

export const CRIVO_CAPABILITIES = [
  "read",
  "analyze",
  "sandbox",
  "validate",
  "prepare_apply",
  "apply_production",
] as const;
export type CrivoCapability = (typeof CRIVO_CAPABILITIES)[number];

export const CRIVO_LIFECYCLE_EVENTS = [
  "detected",
  "analyzing",
  "sandbox_preparing",
  "sandbox_ready",
  "validating",
  "validation_passed",
  "validation_failed",
  "awaiting_approval",
  "approval_rejected",
  "blocked",
  "killed",
  "backup_started",
  "backup_completed",
  "rollback_started",
  "rollback_completed",
  "failed",
] as const;
export type CrivoLifecycleEvent = (typeof CRIVO_LIFECYCLE_EVENTS)[number];

export interface CrivoApproval {
  fingerprint: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  consumedAt: string | null;
}

export interface CrivoChangeFingerprintInput {
  forkCommit: string;
  upstreamCommit: string;
  fromVersion?: string | null;
  toVersion?: string | null;
}

export type CrivoEnvironmentResolution =
  | { ok: true; environment: CrivoEnvironment }
  | { ok: false; reason: "missing_environment" | "invalid_environment" };

export function resolveCrivoEnvironment(
  env: Record<string, string | undefined> = process.env,
): CrivoEnvironmentResolution {
  const raw = env.CRIVO_ENVIRONMENT?.trim().toLowerCase();
  if (!raw) return { ok: false, reason: "missing_environment" };
  if (!CRIVO_ENVIRONMENTS.includes(raw as CrivoEnvironment)) {
    return { ok: false, reason: "invalid_environment" };
  }
  return { ok: true, environment: raw as CrivoEnvironment };
}

export function crivoCapabilities(
  resolution: CrivoEnvironmentResolution,
  killSwitch: boolean,
): Readonly<Record<CrivoCapability, boolean>> {
  const safeOnly = !resolution.ok || killSwitch;
  const environment = resolution.ok ? resolution.environment : null;
  return {
    read: true,
    analyze: true,
    sandbox: !safeOnly && environment !== "production",
    validate: !safeOnly && environment !== "production",
    prepare_apply: !safeOnly && environment !== "production",
    apply_production: !safeOnly && environment === "production",
  };
}

export function fingerprintCrivoChange(input: CrivoChangeFingerprintInput): string {
  const canonical = JSON.stringify({
    fork_commit: input.forkCommit.trim(),
    upstream_commit: input.upstreamCommit.trim(),
    from_version: input.fromVersion?.trim() ?? "",
    to_version: input.toVersion?.trim() ?? "",
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function hasValidCrivoApproval(approval: CrivoApproval | null | undefined, fingerprint: string): boolean {
  return Boolean(
    approval?.fingerprint === fingerprint &&
      approval.approvedBy &&
      approval.approvedAt &&
      !approval.consumedAt,
  );
}

export function sanitizeCrivoText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "Falha desconhecida no Crivo.");
  return raw
    .replace(/https?:\/\/[^\s]+/gi, "[url]")
    .replace(/(token|secret|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .slice(0, 500);
}
