import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { autorizaCron } from "@/lib/auth/cron-auth";
import { runCvCrmIngest } from "@/lib/cv-crm/ingest";
const LOG_PREFIX = "[cv-crm-ingest]";
export async function GET(req: NextRequest) {
  if (!autorizaCron(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const requestId = crypto.randomUUID();
  try {
    const result = await runCvCrmIngest({ orgId: undefined, batchSize: 1000 });
    console.info(`${LOG_PREFIX} completed`, result);
    return NextResponse.json(result);
  } catch (err) {
    console.error(`${LOG_PREFIX} failed`, { requestId, err });
    return NextResponse.json({ requestId, error: "ingestion_failed" }, { status: 500 });
  }
}
