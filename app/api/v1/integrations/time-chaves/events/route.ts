import { type NextRequest } from "next/server";
import { z } from "zod";

import { authorizeIntegration, deterministicAuditId } from "@/lib/integrations/external-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const AGENTS = ["main", "chiquinha", "dona-florinda", "kiko", "senhor-barriga", "professor-girafales", "seu-madruga", "bruxa-do-71", "chapolin"] as const;
const schema = z.object({
  correlation_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  event_type: z.enum(["task.started", "task.completed", "task.failed", "evidence.verified"]),
  task_id: z.string().uuid().optional(),
  agent_id: z.enum(AGENTS).optional(),
  result: z.enum(["ok", "error", "blocked"]).optional(),
  summary: z.string().trim().max(500).optional(),
  evidence_token: z.string().trim().max(256).optional(),
  occurred_at: z.string().datetime().optional(),
}).strict();

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authorizeIntegration(req, "integration:time_chaves:write");
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  let input: z.infer<typeof schema>;
  try { input = schema.parse(await req.json()); }
  catch { return Response.json({ ok: false, error: "invalid_payload" }, { status: 422 }); }

  const supabase = createAdminClient();
  const id = deterministicAuditId(auth.organizationId, "time_chaves", input.correlation_id);
  const { error } = await supabase.from("api_audit_log").insert({
    id, organization_id: auth.organizationId, actor_api_token_id: auth.apiTokenId,
    action: "integration.time_chaves.event_received", resource_type: "time_chaves_task",
    request_id: input.correlation_id, metadata: { source: "time_chaves", ...input },
  });
  if (error?.code === "23505") return Response.json({ ok: true, duplicate: true, correlation_id: input.correlation_id });
  if (error) return Response.json({ ok: false, error: "audit_write_failed" }, { status: 500 });
  return Response.json({ ok: true, duplicate: false, correlation_id: input.correlation_id }, { status: 201 });
}
