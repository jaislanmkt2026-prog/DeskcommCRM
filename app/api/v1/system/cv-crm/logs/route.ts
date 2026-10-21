import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { fail, ok } from "@/lib/api/wrappers";

/**
 * GET /api/v1/system/cv-crm/logs?orgId=&limit=&since=&until=
 * Lista batches de ingestÃ£o CV CRM para diagnÃ³stico operacional.
 * Sem payload sensÃ­vel â€” apenas contadores, timestamps e status.
 */
export async function GET(req: NextRequest) {
  const auth = await loadAuthUser();
  if (!auth) return fail("unauthorized", "Authentication required", 401);

  const { searchParams } = new URL(req.url);
  const orgId = searchParams.get("orgId");
  const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
  const since = searchParams.get("since");
  const until = searchParams.get("until");

  // service_role ignora RLS. Sem filtro obrigatÃ³rio de organization_id, qualquer
  // usuÃ¡rio autenticado lista logs de todos os tenants. Platform admin vÃª tudo
  // (diagnÃ³stico da instalaÃ§Ã£o); demais sÃ³ veem o prÃ³prio tenant.
  if (!auth.is_platform_admin && !orgId) {
    return fail(
      "forbidden",
      "orgId Ã© obrigatÃ³rio para usuÃ¡rios que nÃ£o sÃ£o administrador da instalaÃ§Ã£o.",
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

  const supabase = createAdminClient();

  let query = supabase
    .from("cv_crm_ingestion_logs")
    .select(
      "id, organization_id, batch_id, started_at, finished_at, total_records, valid_records, invalid_records, processed_records, status, error_message",
    )
    .order("started_at", { ascending: false })
    .limit(limit);

  if (orgId) {
    query = query.eq("organization_id", orgId);
  }
  if (since) {
    query = query.gte("started_at", since);
  }
  if (until) {
    query = query.lte("started_at", until);
  }

  const { data, error } = await query;

  if (error) {
    return fail("db_query_failed", error.message, 500);
  }

  // Auditoria de leitura â€” sem payload sensÃ­vel, apenas parÃ¢metros de filtro
  await audit({
    action: "cv_crm.logs_listed",
    actorUserId: auth.id,
    organizationId: orgId ?? undefined,
    actingAsPlatformAdmin: auth.is_platform_admin,
    resourceType: "cv_crm_ingestion_logs",
    metadata: {
      orgId: orgId ?? null,
      limit,
      since,
      until,
      result_count: data?.length ?? 0,
    },
  });

  return ok(data);
}
