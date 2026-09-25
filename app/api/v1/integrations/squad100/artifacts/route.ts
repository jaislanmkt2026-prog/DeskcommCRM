import { type NextRequest } from "next/server";
import { z } from "zod";

import { authorizeIntegration, deterministicAuditId } from "@/lib/integrations/external-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const schema = z
  .object({
    correlation_id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9._:-]+$/),
    squad: z.string().trim().min(1).max(80),
    kind: z.enum(["content", "campaign_analysis", "copy", "video", "landing_page", "report"]),
    title: z.string().trim().min(1).max(200),
    artifact_ref: z.string().trim().max(500).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional(),
    status: z.enum(["generated", "review_required", "approved", "rejected"]).default("generated"),
    created_at: z.string().datetime().optional(),
  })
  .strict();

export async function POST(req: NextRequest): Promise<Response> {
  const auth = await authorizeIntegration(req, "integration:squad100:write");
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  let input: z.infer<typeof schema>;
  try {
    input = schema.parse(await req.json());
  } catch {
    return Response.json({ ok: false, error: "invalid_payload" }, { status: 422 });
  }

  const supabase = createAdminClient();
  const id = deterministicAuditId(
    auth.organizationId,
    "squad100",
    input.correlation_id,
    input.kind,
  );
  const { error } = await supabase.from("api_audit_log").insert({
    id,
    organization_id: auth.organizationId,
    actor_api_token_id: auth.apiTokenId,
    action: "integration.squad100.artifact_received",
    resource_type: "squad100_artifact",
    request_id: input.correlation_id,
    metadata: { source: "squad100", ...input },
  });
  if (error?.code === "23505")
    return Response.json({ ok: true, duplicate: true, correlation_id: input.correlation_id });
  if (error) return Response.json({ ok: false, error: "audit_write_failed" }, { status: 500 });
  return Response.json(
    { ok: true, duplicate: false, correlation_id: input.correlation_id },
    { status: 201 },
  );
}
