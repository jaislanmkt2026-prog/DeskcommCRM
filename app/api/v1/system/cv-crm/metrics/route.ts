import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { fail, ok } from "@/lib/api/wrappers";

/**
 * GET /api/v1/system/cv-crm/metrics?orgId=&window=24h|7d|30d
 * Retorna agregados das últimas N horas/dias: contagem de batches por status,
 * taxa de sucesso, tempo médio, contagem de stale. Sem payload sensível.
 */
export async function GET(req: NextRequest) {
  const auth = await loadAuthUser();
  if (!auth) return fail("unauthorized", "Authentication required", 401);

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId");
  const windowParam = searchParams.get("window") || "24h";

  // service_role ignora RLS. Sem filtro obrigatório de organization_id, qualquer
  // usuário autenticado vê métricas agregadas de todos os tenants. Platform admin
  // vê tudo (diagnóstico da instalação); demais só veem o próprio tenant.
  if (!auth.is_platform_admin && !orgId) {
    return fail(
      "forbidden",
      "orgId é obrigatório para usuários que não são administrador da instalação.",
      403,
    );
  }

  if (
    !auth.is_platform_admin &&
    orgId &&
    !auth.organizations.some((membership) => membership.organization_id === orgId) &&
    auth.support?.organization_id !== orgId
  ) {
    return fail("forbidden_tenant", "Organização fora do escopo do usuário.", 403);
  }

  // Parse window
  let hours = 24;
  if (windowParam === "7d") hours = 168;
  else if (windowParam === "30d") hours = 720;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

  const supabase = createAdminClient();

  // Query base com filtro de tenant e período
  let baseQuery = supabase
    .from("cv_crm_ingestion_logs")
    .select(
      "status, total_records, valid_records, invalid_records, processed_records, started_at, finished_at",
    )
    .gte("started_at", since);

  if (orgId) {
    baseQuery = baseQuery.eq("organization_id", orgId);
  }

  const { data: logs, error } = await baseQuery;
  if (error) {
    return fail("db_query_failed", error.message, 500);
  }

  // Agregações em memória (sem expor dados brutos)
  const totalBatches = logs.length;
  const completedBatches = logs.filter((l) => l.status === "completed").length;
  const failedBatches = logs.filter((l) => l.status === "failed").length;
  const partialBatches = logs.filter((l) => l.status === "partial").length;
  const successRate = totalBatches > 0 ? (completedBatches / totalBatches) * 100 : 0;

  const totalRecords = logs.reduce((sum, l) => sum + (l.total_records || 0), 0);
  const totalValid = logs.reduce((sum, l) => sum + (l.valid_records || 0), 0);
  const totalInvalid = logs.reduce((sum, l) => sum + (l.invalid_records || 0), 0);
  const totalProcessed = logs.reduce((sum, l) => sum + (l.processed_records || 0), 0);

  // Tempo médio de duração (em segundos)
  const durations = logs
    .filter((l) => l.started_at && l.finished_at)
    .map((l) => (new Date(l.finished_at!).getTime() - new Date(l.started_at!).getTime()) / 1000);
  const avgDurationSec =
    durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : null;

  // Contagem de stale (requer query separada nas tabelas alvo)
  let staleQuery = supabase
    .from("real_estate_developments")
    .select("id", { count: "exact" })
    .not("cv_crm_stale_since", "is", null);

  if (orgId) {
    staleQuery = staleQuery.eq("organization_id", orgId);
  }

  const { count: staleDevelopments, error: staleDevError } = await staleQuery;
  if (staleDevError) {
    return fail("db_query_failed", staleDevError.message, 500);
  }

  let staleUnits = 0;
  {
    let staleUnitsQuery = supabase
      .from("real_estate_units")
      .select("id", { count: "exact" })
      .not("cv_crm_stale_since", "is", null);

    if (orgId) {
      staleUnitsQuery = staleUnitsQuery.eq("organization_id", orgId);
    }

    const { count, error: staleUnitsError } = await staleUnitsQuery;
    if (staleUnitsError) {
      return fail("db_query_failed", staleUnitsError.message, 500);
    }
    staleUnits = count || 0;
  }

  const metrics = {
    window: windowParam,
    since,
    total_batches: totalBatches,
    completed_batches: completedBatches,
    failed_batches: failedBatches,
    partial_batches: partialBatches,
    success_rate_percent: Math.round(successRate * 100) / 100,
    total_records: totalRecords,
    total_valid: totalValid,
    total_invalid: totalInvalid,
    total_processed: totalProcessed,
    avg_duration_seconds: avgDurationSec ? Math.round(avgDurationSec * 100) / 100 : null,
    stale_developments: staleDevelopments || 0,
    stale_units: staleUnits,
  };

  // Auditoria de leitura — sem payload sensível
  await audit({
    action: "cv_crm.metrics_viewed",
    actorUserId: auth.id,
    organizationId: orgId ?? undefined,
    actingAsPlatformAdmin: auth.is_platform_admin,
    resourceType: "cv_crm_metrics",
    metadata: {
      orgId: orgId ?? null,
      window: windowParam,
    },
  });

  return ok(metrics);
}
