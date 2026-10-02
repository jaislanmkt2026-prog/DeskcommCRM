import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;

const SELECT =
  "id, title, status, source, tags, created_at, pipeline_id, stage_id, contact_id, " +
  "pipeline:crm_pipelines(name), stage:crm_stages!crm_leads_stage_id_fkey(name), contact:contacts(id, phone_number, display_name, name)";

function limpa(texto: string): string {
  return texto.replace(/[%,()*\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("agent", { requestId, resource: "crm_leads" });
  if (!authz.ok) return authz.response;
  const t = (texto: string) => traduzir(texto, authz.user.idioma);
  const orgId = authz.org.orgId;

  const p = req.nextUrl.searchParams;
  const q = limpa(p.get("q") ?? "");
  const origem = (p.get("origem") ?? "").trim();
  const tag = (p.get("tag") ?? "").trim();
  const funil = (p.get("funil") ?? "").trim();
  const pagina = Math.max(1, Number.parseInt(p.get("pagina") ?? "1", 10) || 1);

  const supabase = await createClient();

  let query = supabase
    .from("crm_leads")
    .select(SELECT, { count: "exact" })
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);
  if (q) query = query.ilike("title", `%${q}%`);
  if (origem) query = query.eq("source", origem);
  if (tag) query = query.contains("tags", [tag]);
  if (funil) query = query.eq("pipeline_id", funil);

  const { data, count, error } = await query;
  if (error) {
    return fail("internal_error", t("Falha ao listar leads."), 500, { requestId });
  }

  const [{ data: facetas }, { data: funis }] = await Promise.all([
    supabase.from("crm_leads").select("source, tags").eq("organization_id", orgId).limit(3000),
    supabase.from("crm_pipelines").select("id, name").eq("organization_id", orgId).eq("is_archived", false),
  ]);
  const origens = new Set<string>();
  const tags = new Set<string>();
  for (const l of (facetas ?? []) as Array<{ source: string | null; tags: string[] | null }>) {
    if (l.source) origens.add(l.source);
    for (const x of l.tags ?? []) tags.add(x);
  }

  return ok(
    {
      leads: (data ?? []) as unknown[],
      total: count ?? 0,
      por_pagina: POR_PAGINA,
      origens: [...origens].sort(),
      tags: [...tags].sort(),
      funis: (funis ?? []) as Array<{ id: string; name: string }>,
    },
    { requestId },
  );
}