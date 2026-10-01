/**
 * P0-B Missão 7.7 — Orquestrador do ciclo Crivo.
 *
 * Fecha o laço detectar → analisar → classificar → gates → dispatch.
 * O upstream-monitor já faz detectar+analisar; aqui entra a decisão de
 * aplicar automaticamente (risco BAIXO + análise completa + gates verdes)
 * ou parar e pedir revisão humana (fail-closed para risco ALTO, incompleto,
 * production sem approval, kill switch, etc.).
 *
 * Rollback automático (P0-C) será implementado como handler de run falho
 * na próxima iteração; este módulo foca no despacho seguro e atômico.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  crivoCapabilities,
  hasValidCrivoApproval,
  resolveCrivoEnvironment,
  sanitizeCrivoText,
  type CrivoCapability,
} from "@/lib/system/crivo-control";
import type { NivelRisco, StatusAnalise } from "@/lib/system/upstream-monitor";
import type { RunStatus } from "@/lib/system/update-run";

type AdminClient = ReturnType<typeof createAdminClient>;

export type CicloResultado =
  | { fase: "skipped"; motivo: string }
  | { fase: "blocked"; motivo: string; risco?: NivelRisco }
  | { fase: "dispatched"; runId: string; status: RunStatus }
  | { fase: "failed"; erro: string };

interface EstadoUpstream {
  analysis_status: StatusAnalise | null;
  risk_level: NivelRisco | null;
  update_available: boolean | null;
  change_fingerprint: string | null;
  approval_fingerprint: string | null;
  approval_approved_by: string | null;
  approval_approved_at: string | null;
  approval_consumed_at: string | null;
  kill_switch: boolean | null;
  crivo_environment: string | null;
  latest_upstream_commit: string | null;
  local_commit: string | null;
}

const RISCO_AUTO_APLICAVEL: readonly NivelRisco[] = ["low"];

function podeAplicarAutomaticamente(
  caps: Readonly<Record<CrivoCapability, boolean>>,
  analiseCompleta: boolean,
  risco: NivelRisco | null,
): boolean {
  if (!analiseCompleta) return false;
  if (!risco || !RISCO_AUTO_APLICAVEL.includes(risco)) return false;
  return caps.validate && caps.prepare_apply;
}

function exigeRevisaoHumana(risco: NivelRisco | null, analiseCompleta: boolean): boolean {
  if (!analiseCompleta) return true;
  if (!risco) return true;
  return !RISCO_AUTO_APLICAVEL.includes(risco);
}

export async function executarCicloCrivo(options?: {
  db?: AdminClient;
  env?: Record<string, string | undefined>;
}): Promise<CicloResultado> {
  const db = options?.db ?? (await import("@/lib/supabase/admin")).createAdminClient();
  const ambiente = resolveCrivoEnvironment(options?.env ?? process.env);

  const { data: state, error: stateError } = await db
    .from("system_upstream_state")
    .select(
      "analysis_status,risk_level,update_available,change_fingerprint,approval_fingerprint,approval_approved_by,approval_approved_at,approval_consumed_at,kill_switch,crivo_environment,latest_upstream_commit,local_commit",
    )
    .eq("id", 1)
    .maybeSingle();

  if (stateError) {
    return { fase: "failed", erro: sanitizeCrivoText(stateError.message) };
  }
  if (!state) {
    return { fase: "skipped", motivo: "system_upstream_state ausente." };
  }

  const s = state as EstadoUpstream;

  if (s.kill_switch) {
    return { fase: "blocked", motivo: "Kill switch ativo.", risco: s.risk_level ?? undefined };
  }

  if (!ambiente.ok) {
    return {
      fase: "blocked",
      motivo:
        ambiente.reason === "missing_environment"
          ? "CRIVO_ENVIRONMENT ausente."
          : "CRIVO_ENVIRONMENT inválido.",
    };
  }

  if (!s.update_available) {
    return { fase: "skipped", motivo: "Nenhuma atualização disponível." };
  }

  if (s.analysis_status !== "completed") {
    return {
      fase: "blocked",
      motivo: `Análise incompleta (${s.analysis_status ?? "desconhecido"}).`,
      risco: s.risk_level ?? undefined,
    };
  }

  const caps = crivoCapabilities(ambiente, Boolean(s.kill_switch));
  const fingerprint = s.change_fingerprint ?? "";
  const revisaoHumana = exigeRevisaoHumana(s.risk_level, s.analysis_status === "completed");

  if (revisaoHumana) {
    return {
      fase: "blocked",
      motivo:
        s.risk_level && !RISCO_AUTO_APLICAVEL.includes(s.risk_level)
          ? `Risco ${s.risk_level.toUpperCase()} exige revisão humana.`
          : "Análise incompleta exige revisão humana.",
      risco: s.risk_level ?? undefined,
    };
  }

  if (!podeAplicarAutomaticamente(caps, s.analysis_status === "completed", s.risk_level)) {
    return {
      fase: "blocked",
      motivo: "Capabilities insuficientes para aplicação automática neste ambiente.",
      risco: s.risk_level ?? undefined,
    };
  }

  // Production exige approval one-shot consumível; sem ele, bloqueia.
  if (ambiente.environment === "production") {
    if (
      !hasValidCrivoApproval(
        {
          fingerprint: s.approval_fingerprint,
          approvedBy: s.approval_approved_by,
          approvedAt: s.approval_approved_at,
          consumedAt: s.approval_consumed_at,
        },
        fingerprint,
      )
    ) {
      return {
        fase: "blocked",
        motivo: "Production exige aprovação específica não consumida.",
        risco: s.risk_level ?? undefined,
      };
    }
  }

  if (!fingerprint || !s.latest_upstream_commit || !s.local_commit) {
    return { fase: "failed", erro: "Fingerprint ou commits ausentes no estado." };
  }

  try {
    const { data: run, error: dispatchError } = await db.rpc("fn_crivo_dispatch_update", {
      p_from_version: s.local_commit,
      p_to_version: s.latest_upstream_commit,
      p_requested_by: s.approval_approved_by ?? "00000000-0000-0000-0000-000000000000",
      p_fingerprint: fingerprint,
      p_environment: ambiente.environment,
    });

    if (dispatchError || !run) {
      return {
        fase: "failed",
        erro: sanitizeCrivoText(dispatchError?.message ?? "dispatch sem retorno"),
      };
    }

    return { fase: "dispatched", runId: String(run), status: "dispatched" };
  } catch (err) {
    return { fase: "failed", erro: sanitizeCrivoText(err) };
  }
}
