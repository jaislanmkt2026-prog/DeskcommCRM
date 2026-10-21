import type { NextRequest } from "next/server";
import { ok } from "@/lib/api/wrappers";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest): Promise<Response> {
  return ok({ status: "healthy", timestamp: new Date().toISOString() });
}
