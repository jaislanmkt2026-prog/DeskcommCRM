import { createAdminClient } from "@/lib/supabase/admin";

export type CvCrmSnapshotExternalIds = {
  development: string[];
  unit: string[];
};

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function reconcileStaleRecords(
  orgId: string,
  snapshotExternalIds: CvCrmSnapshotExternalIds,
): Promise<{ staleCount: number; errors: string[] }> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS).toISOString();
  const staleSince = now.toISOString();
  const supabase = createAdminClient();
  const errors: string[] = [];
  let staleCount = 0;

  const targets = [
    {
      table: "real_estate_developments",
      externalIds: snapshotExternalIds.development,
    },
    {
      table: "real_estate_units",
      externalIds: snapshotExternalIds.unit,
    },
  ] as const;

  for (const target of targets) {
    try {
      let query = supabase
        .from(target.table)
        .update({ cv_crm_stale_since: staleSince }, { count: "exact" })
        .eq("organization_id", orgId)
        .not("external_id", "is", null)
        .lt("cv_crm_last_seen_at", cutoff)
        .is("cv_crm_stale_since", null);

      if (target.externalIds.length > 0) {
        query = query.not(
          "external_id",
          "in",
          `(${target.externalIds.map(quotePostgrestValue).join(",")})`,
        );
      }

      const { count, error } = await query;
      if (error) {
        errors.push(`${target.table}: ${error.message}`);
        continue;
      }
      staleCount += count ?? 0;
    } catch (error) {
      errors.push(`${target.table}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { staleCount, errors };
}

function quotePostgrestValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
