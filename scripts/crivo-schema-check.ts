/**
 * Diagnóstico de schema das tabelas Crivo para corrigir simulação E2E.
 *
 * Importers/callers: standalone, invocado via `pnpm tsx scripts/crivo-schema-check.ts`.
 * Affected schemas: lê system_update_runs e system_upstream_state (tabelas existentes).
 * User instruction: "faça isso" (simulações E2E SAFE/FAIL/HIGH).
 */
import { createAdminClient } from "../lib/supabase/admin";

async function main() {
  const db = createAdminClient();
  const { data: runs } = await db.from("system_update_runs").select("*").limit(1);
  const { data: state } = await db.from("system_upstream_state").select("*").limit(1);
  console.log("RUNS_COLS:", JSON.stringify(Object.keys(runs?.[0] ?? {})));
  console.log("STATE_COLS:", JSON.stringify(Object.keys(state?.[0] ?? {})));
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
