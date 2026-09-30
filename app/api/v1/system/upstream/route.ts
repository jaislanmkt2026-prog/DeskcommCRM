import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCrivoEnvironment } from "@/lib/system/crivo-control";
import { executarCrivoUpstream } from "@/lib/system/upstream-monitor";

export const dynamic = "force-dynamic";

const postSchema = z.object({ action: z.enum(["check", "approve", "reject", "kill", "unkill"]) }).strict();

type AdminAuth =
  | { user: NonNullable<Awaited<ReturnType<typeof loadAuthUser>>>; response: null }
  | { user: null; response: Response };


async function appendLifecycleEvent(
  db: ReturnType<typeof createAdminClient>,
  event: "approval_rejected" | "killed",
): Promise<void> {
  const { data: latest } = await db
    .from("system_upstream_checks")
    .select("id,events")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!latest?.id) return;
  const events = Array.isArray(latest.events) ? latest.events : [];
  await db.from("system_upstream_checks").update({ events: [...events, event] }).eq("id", latest.id);
}

async function adminDaInstalacao(): Promise<AdminAuth> {
  const user = await loadAuthUser();
  if (!user) return { user: null, response: fail("unauthenticated", "Faça login para continuar.", 401) };
  if (!user.is_platform_admin) {
    return {
      user: null,
      response: fail("forbidden", "Só o administrador da instalação pode abrir o Crivo.", 403),
    };
  }
  return { user, response: null };
}

export async function GET(): Promise<Response> {
  const auth = await adminDaInstalacao();
  if (auth.response) return auth.response;

  const db = createAdminClient();
  const [{ data: state, error: stateError }, { data: history, error: historyError }] =
    await Promise.all([
      db.from("system_upstream_state").select("*").eq("id", 1).maybeSingle(),
      db
        .from("system_upstream_checks")
        .select(
          "id,repository,default_branch,local_commit,upstream_commit,started_at,finished_at,result,commits_delta,commits_analyzed,files_delta,files_analyzed,risk_level,analysis_status,events,summary,error",
        )
        .order("started_at", { ascending: false })
        .limit(20),
    ]);

  if (stateError || historyError) {
    return fail("internal_error", "Não consegui ler o estado do Crivo interno.", 500);
  }
  return ok({ state, history: history ?? [] });
}

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;

  const auth = await adminDaInstalacao();
  if (auth.response) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail("validation_error", "JSON inválido.", 400, { requestId });
  }
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return fail("validation_error", "Ação inválida.", 400, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  if (parsed.data.action === "check") {
    const result = await executarCrivoUpstream();
    await audit({
      action: "system.upstream_check_requested",
      actorUserId: auth.user.id,
      actingAsPlatformAdmin: true,
      metadata: { result: result.result, analysis_status: result.analysis_status },
      requestId,
    });
    return ok(result, { requestId });
  }

  const db = createAdminClient();
  const now = new Date().toISOString();
  const { data: state, error: stateError } = await db
    .from("system_upstream_state")
    .select("crivo_environment,kill_switch,change_fingerprint,analysis_status")
    .eq("id", 1)
    .maybeSingle();
  if (stateError || !state) return fail("internal_error", "Não consegui ler o estado do Crivo.", 500, { requestId });

  if (parsed.data.action === "kill") {
    const { error } = await db.from("system_upstream_state").update({
      kill_switch: true,
      approval_fingerprint: null,
      approval_approved_by: null,
      approval_approved_at: null,
      approval_consumed_at: null,
      updated_at: now,
    }).eq("id", 1);
    if (error) return fail("internal_error", "Não consegui acionar o kill switch.", 500, { requestId });
    await appendLifecycleEvent(db, "killed");
  } else if (parsed.data.action === "unkill") {
    const { error } = await db.from("system_upstream_state").update({ kill_switch: false, updated_at: now }).eq("id", 1);
    if (error) return fail("internal_error", "Não consegui liberar o Crivo.", 500, { requestId });
  } else if (parsed.data.action === "reject") {
    const { error } = await db.from("system_upstream_state").update({
      approval_fingerprint: null,
      approval_approved_by: null,
      approval_approved_at: null,
      approval_consumed_at: null,
      updated_at: now,
    }).eq("id", 1);
    if (error) return fail("internal_error", "Não consegui rejeitar a aprovação.", 500, { requestId });
    await appendLifecycleEvent(db, "approval_rejected");
  } else {
    const environment = resolveCrivoEnvironment();
    if (!environment.ok || environment.environment !== "production" || state.crivo_environment !== "production") {
      return fail("state_conflict", "Aprovação explícita só é válida no ambiente production configurado.", 409, { requestId });
    }
    if (state.kill_switch) return fail("state_conflict", "Crivo está bloqueado pelo kill switch.", 409, { requestId });
    if (!state.change_fingerprint) return fail("state_conflict", "Não há mudança analisada para aprovar.", 409, { requestId });
    if (state.analysis_status !== "completed") {
      return fail("state_conflict", "A análise do Crivo precisa estar completa antes da aprovação.", 409, { requestId });
    }
    const { data: approved, error } = await db.from("system_upstream_state").update({
      approval_fingerprint: state.change_fingerprint,
      approval_approved_by: auth.user.id,
      approval_approved_at: now,
      approval_consumed_at: null,
      updated_at: now,
    }).eq("id", 1).eq("change_fingerprint", state.change_fingerprint).select("id").maybeSingle();
    if (error) return fail("internal_error", "Não consegui registrar a aprovação.", 500, { requestId });
    if (!approved) {
      return fail("state_conflict", "A mudança do Crivo mudou; analise novamente antes de aprovar.", 409, { requestId });
    }
  }

  await audit({
    action: "system.upstream_check_requested",
    actorUserId: auth.user.id,
    actingAsPlatformAdmin: true,
    metadata: { operation: parsed.data.action, change_fingerprint: state.change_fingerprint ?? null },
    requestId,
  });
  return ok({ action: parsed.data.action }, { requestId });
}
