import { createAdminClient } from "@/lib/supabase/admin";

const TABLES = [
  "real_estate_developments",
  "real_estate_units",
  "real_estate_price_lists",
  "real_estate_price_list_items",
] as const;

export async function reconcileStaleRecords(
  orgId: string,
  batchExternalIds: string[],
  batchStartedAt: Date,
): Promise<{ staleCount: number; errors: string[] }> {
  let totalStale = 0;
  const errors: string[] = [];
  const supabase = createAdminClient();

  for (const table of TABLES) {
    try {
      const { count, error } = await supabase
        .from(table)
        .update({ cv_crm_stale_since: new Date().toISOString() })
        .eq("organization_id", orgId)
        .not("external_id", "in", batchExternalIds)
        .lt("cv_crm_last_seen_at", batchStartedAt.toISOString())
        .is("cv_crm_stale_since", null);

      if (error) {
        errors.push(`${table}: ${error.message}`);
        continue;
      }

      totalStale += count ?? 0;
    } catch (err) {
      errors.push(`${table}: ${String(err)}`);
    }
  }

  return { staleCount: totalStale, errors };
}
