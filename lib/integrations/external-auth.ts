import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";

import { ensureRole, ensureScope, McpAuthError, validateBearerToken } from "@/lib/mcp/auth";

export type IntegrationAuth =
  | {
      ok: true;
      organizationId: string;
      apiTokenId: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function authorizeIntegration(
  req: NextRequest,
  requiredScope: string,
): Promise<IntegrationAuth> {
  try {
    const auth = await validateBearerToken(req.headers.get("authorization"));
    ensureScope(auth.scopes, requiredScope);
    ensureRole(auth.role, "viewer");
    return { ok: true, organizationId: auth.organizationId, apiTokenId: auth.apiTokenId };
  } catch (err) {
    if (err instanceof McpAuthError) {
      return { ok: false, status: err.httpStatus, error: err.message };
    }
    throw err;
  }
}

/**
 * UUID determinístico para idempotência de eventos externos sem tabela paralela.
 * O mesmo tenant/source/correlationId/eventType sempre produz a mesma PK em api_audit_log.
 * eventType é obrigatório para evitar colisão entre task.started e task.completed com mesmo correlation_id.
 */
export function deterministicAuditId(
  organizationId: string,
  source: string,
  correlationId: string,
  eventType: string,
): string {
  const hex = createHash("sha256")
    .update(`${organizationId}:${source}:${correlationId}:${eventType}`)
    .digest("hex")
    .slice(0, 32);

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
