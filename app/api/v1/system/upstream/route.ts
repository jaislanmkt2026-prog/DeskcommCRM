import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { fail, ok } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { loadAuthUser } from "@/lib/auth/server";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { createAdminClient } from "@/lib/supabase/admin";
import { executarCrivoUpstream } from "@/lib/system/upstream-monitor";

export const dynamic = "force-dynamic";

const postSchema = z.object({ action: z.literal("check") }).strict();

type AdminAuth =
  | { user: NonNullable<Awaited<ReturnType<typeof loadAuthUser>>>; response: null }
  | { user: null; response: Response };

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
