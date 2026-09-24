import { type NextRequest } from "next/server";

import { authorizeIntegration } from "@/lib/integrations/external-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function exactCount(table: string, organizationId: string, extra?: (query: any) => any): Promise<number> {
  const supabase = createAdminClient();
  let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  if (extra) query = extra(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await authorizeIntegration(req, "integration:time_chaves:read");
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });

  const org = auth.organizationId;
  try {
    const [contacts, leads, conversations, pending, aiHandling, messages, humanTakeovers] = await Promise.all([
      exactCount("contacts", org),
      exactCount("crm_leads", org),
      exactCount("conversations", org),
      exactCount("conversations", org, (q) => q.eq("status", "pending")),
      exactCount("conversations", org, (q) => q.eq("status", "ai_handling")),
      exactCount("messages", org),
      exactCount("contacts", org, (q) => q.eq("force_human", true)),
    ]);

    return Response.json({
      ok: true,
      source: "deskcommcrm",
      canonical: true,
      generated_at: new Date().toISOString(),
      contacts: { total: contacts, force_human: humanTakeovers },
      leads: { total: leads },
      conversations: { total: conversations, pending, ai_handling: aiHandling },
      messages: { total: messages },
    });
  } catch (err) {
    console.error("[integration.time-chaves.state] canonical read failed", err);
    return Response.json({ ok: false, error: "canonical_state_unavailable" }, { status: 503 });
  }
}
