import { type NextRequest } from "next/server";

import { authorizeIntegration } from "@/lib/integrations/external-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function exactCount(
  table: string,
  organizationId: string,
  extra?: { column: string; value: string | boolean },
): Promise<number> {
  const supabase = createAdminClient();
  let query = supabase.from(table).select("id", { count: "exact", head: true }).eq("organization_id", organizationId);
  if (extra) query = query.eq(extra.column, extra.value);
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
      exactCount("conversations", org, { column: "status", value: "pending" }),
      exactCount("conversations", org, { column: "status", value: "ai_handling" }),
      exactCount("messages", org),
      exactCount("contacts", org, { column: "force_human", value: true }),
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
