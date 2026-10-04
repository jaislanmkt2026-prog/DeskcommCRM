import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { runCvCrmIngest } from "@/lib/cv-crm/ingest";
import { audit } from "@/lib/audit";
import { env } from "@/lib/env";
const LOG_PREFIX = "[cv-crm-ingest]";
const TIMEOUT_MS = 5 * 60_000; // 5 minutos

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("timeout")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function GET(req: NextRequest) {
  if (!autorizaCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const requestId = crypto.randomUUID();
  const organizationId = env.CV_CRM_ORG_ID.trim() || undefined;
  try {
    const result = await withTimeout(
      runCvCrmIngest({ orgId: organizationId, batchSize: 1000 }),
      TIMEOUT_MS,
    );

    // Auditoria: registra início e fim da ingestão no api_audit_log
    // Metadata mínima — sem payload sensível, apenas contadores e batch_id
    await audit({
      action:
        result.status === "ok"
          ? "cv_crm.ingestion_completed"
          : result.total_records > 0 && result.processed > 0
            ? "cv_crm.ingestion_partial"
            : "cv_crm.ingestion_failed",
      actorUserId: null, // cron não tem usuário autenticado
      organizationId,
      resourceType: "cv_crm_ingestion",
      resourceId: result.batch_id,
      requestId,
      metadata: {
        total_records: result.total_records,
        valid: result.valid,
        invalid: result.invalid,
        processed: result.processed,
        stale_count: result.stale_count,
        status: result.status,
      },
    });

    console.info(`${LOG_PREFIX} completed`, result);
    if (result.status === "error") {
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === "timeout";
    // Auditoria: falha catastrófica ou timeout
    await audit({
      action: "cv_crm.ingestion_failed",
      actorUserId: null,
      organizationId,
      resourceType: "cv_crm_ingestion",
      requestId,
      metadata: {
        error: err instanceof Error ? err.message : String(err),
        isTimeout,
      },
    });

    console.error(`${LOG_PREFIX} failed`, { requestId, err, isTimeout });
    return NextResponse.json(
      { requestId, error: isTimeout ? "ingestion_timeout" : "ingestion_failed" },
      { status: 500 },
    );
  }
}
