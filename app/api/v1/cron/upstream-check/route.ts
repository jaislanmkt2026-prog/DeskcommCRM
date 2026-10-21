import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { executarCrivoUpstream } from "@/lib/system/upstream-monitor";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403);
  }

  // Falha do GitHub é um RESULTADO do Crivo, não falha do scheduler. O módulo
  // registra UPSTREAM_CHECK_FAILED e devolve `failed`; o crond segue saudável.
  const result = await executarCrivoUpstream();
  return ok(result);
}

export const GET = handle;
export const POST = handle;
