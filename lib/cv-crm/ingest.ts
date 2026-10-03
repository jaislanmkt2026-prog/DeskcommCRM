import { fetchBatch } from "./adapter";
import { reconcileStaleRecords } from "./reconcile";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";

type IngestSummary = {
  batch_id: string;
  total_records: number;
  valid: number;
  invalid: number;
  processed: number;
  stale_count: number;
  status: "ok" | "error";
  errors?: string[];
};

export async function runCvCrmIngest(opts?: {
  orgId?: string;
  batchSize?: number;
}): Promise<IngestSummary> {
  const orgId = opts?.orgId ?? env.CV_CRM_ORG_ID;
  if (!orgId) {
    return {
      batch_id: crypto.randomUUID(),
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: ["CV_CRM_ORG_ID não configurada"],
    };
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let records: Awaited<ReturnType<typeof fetchBatch>>;
  try {
    records = await fetchBatch(orgId, since);
  } catch (err) {
    return {
      batch_id: crypto.randomUUID(),
      total_records: 0,
      valid: 0,
      invalid: 0,
      processed: 0,
      stale_count: 0,
      status: "error",
      errors: [String(err)],
    };
  }

  const supabase = createAdminClient();
  const batchStartedAt = new Date();
  const externalIds = records.map((r) => r.external_id);
  let processed = 0;
  let invalid = 0;
  const errors: string[] = [];

  for (const rec of records) {
    try {
      const table =
        rec.entity_type === "development"
          ? "real_estate_developments"
          : rec.entity_type === "unit"
            ? "real_estate_units"
            : rec.entity_type === "price_list"
              ? "real_estate_price_lists"
              : "real_estate_price_list_items";
      const { error } = await supabase
        .from(table)
        .upsert(
          {
            organization_id: orgId,
            external_id: rec.external_id,
            ...rec.payload,
            cv_crm_last_seen_at: batchStartedAt.toISOString(),
          },
          { onConflict: "organization_id,external_id" },
        );
      if (error) {
        invalid++;
        errors.push(`${rec.external_id}: ${error.message}`);
      } else {
        processed++;
      }
    } catch (err) {
      invalid++;
      errors.push(`${rec.external_id}: ${String(err)}`);
    }
  }

  let staleCount = 0;
  let reconcileErrors: string[] = [];
  try {
    const result = await reconcileStaleRecords(orgId, externalIds, batchStartedAt);
    staleCount = result.staleCount;
    reconcileErrors = result.errors;
  } catch (err) {
    reconcileErrors.push(String(err));
  }

  return {
    batch_id: crypto.randomUUID(),
    total_records: records.length,
    valid: records.length - invalid,
    invalid,
    processed,
    stale_count: staleCount,
    status: invalid > 0 || reconcileErrors.length > 0 ? "error" : "ok",
    errors: [...errors, ...reconcileErrors],
  };
}
