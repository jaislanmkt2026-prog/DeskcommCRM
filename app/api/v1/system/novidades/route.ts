import { fail, ok } from "@/lib/api/wrappers";
import { loadAuthUser } from "@/lib/auth/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// O que chegou em cada atualização do Crivo (tabela `system_update_novidades`).
// Só leitura e só o dono do servidor: a tabela é da INSTALAÇÃO, sem RLS por
// organização — o acesso é pelo service_role, como `system_upstream_checks`.
export async function GET(): Promise<Response> {
  const user = await loadAuthUser();
  if (!user) return fail("unauthenticated", "Faça login para continuar.", 401);
  if (!user.is_platform_admin) {
    return fail("forbidden", "Só o administrador da instalação pode ver as novidades.", 403);
  }

  const db = createAdminClient();
  const { data, error } = await db
    .from("system_update_novidades" as never)
    .select("id, aplicada_em, de_sha, para_sha, titulo, resumo, itens")
    .order("aplicada_em", { ascending: false })
    .limit(20);
  if (error) {
    return fail("internal_error", "Não consegui ler as novidades das atualizações.", 500);
  }
  return ok({ novidades: (data ?? []) as unknown[] });
}