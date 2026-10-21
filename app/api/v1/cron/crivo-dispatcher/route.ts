import type { NextRequest } from "next/server";

import { fail, ok } from "@/lib/api/wrappers";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { executarCicloCrivo } from "@/lib/system/crivo-cycle";
import { executarRollbackSeNecessario } from "@/lib/system/crivo-rollback";
import { alertarExcecaoCrivo } from "@/lib/system/crivo-alerts";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest): Promise<Response> {
  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403);
  }

  const ciclo = await executarCicloCrivo();
  const rollbacks = await executarRollbackSeNecessario();
  const alerta = await alertarExcecaoCrivo(createAdminClient(), ciclo, rollbacks);

  return ok({ ciclo, rollbacks, alerta });
}

export const GET = handle;
export const POST = handle;
