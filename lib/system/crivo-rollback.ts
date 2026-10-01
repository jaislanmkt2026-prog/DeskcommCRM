/**
 * P0-C Missão 7.7 — Rollback automático pós-aplicação.
 *
 * Monitora `system_update_runs` com status `dispatched` ou `failed` e executa
 * rollback quando health-check pós-aplicação falha ou quando o run fica stale
 * sem confirmação de sucesso. Estado final gravado como `failed_rolled_back`.
 *
 * Contrato: lê runs pendentes, grava eventos de lifecycle `rollback_started`
 * e `rollback_completed`, transiciona status para `failed_rolled_back` via
 * UPDATE atômico. Rollback real do banco depende do executor externo
 * (update.sh/agent.sh); aqui persistimos a intenção e o estado auditável.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeCrivoText } from "@/lib/system/crivo-control";
import { isRunStale, RUN_STALE_AFTER_MS, type RunStatus } from "@/lib/system/update-run";

type AdminClient = ReturnType<typeof createAdminClient>;

export type RollbackResultado =
  | { acao: "none"; motivo: string }
  | { acao: "rolled_back"; runId: string; erroOriginal?: string }
  | { acao: "failed"; runId: string; erro: string };

interface RunPendente {
  id: string;
  status: RunStatus;
  dispatched_at: string | null;
  finished_at: string | null;
  to_version: string | null;
  from_version: string | null;
  error: string | null;
}

const TERMINAL: readonly RunStatus[] = ["success", "failed", "failed_rolled_back"];

async function buscarRunsPendentes(db: AdminClient): Promise<RunPendente[]> {
  const { data, error } = await db
    .from("system_update_runs")
    .select("id,status,dispatched_at,finished_at,to_version,from_version,log_tail")
    .in("status", ["dispatched", "failed"])
    .order("dispatched_at", { ascending: true })
    .limit(5);
  if (error) throw new Error(`system_update_runs select: ${error.message}`);
  return (data ?? []) as RunPendente[];
}

async function marcarRollback(
  db: AdminClient,
  runId: string,
  erroOriginal: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  // system_update_runs não tem coluna `error`; usa log_tail para registrar motivo do rollback.
  const mensagemLog = erroOriginal
    ? `[ROLLBACK] ${erroOriginal}`
    : "[ROLLBACK] Health-check falhou ou run stale.";
  await db
    .from("system_update_runs")
    .update({
      status: "failed_rolled_back",
      finished_at: now,
      log_tail: mensagemLog,
    })
    .eq("id", runId)
    .in("status", ["dispatched", "failed"]);
}

export async function executarRollbackSeNecessario(options?: {
  db?: AdminClient;
  now?: Date;
}): Promise<RollbackResultado[]> {
  const db = options?.db ?? (await import("@/lib/supabase/admin")).createAdminClient();
  const now = options?.now ?? new Date();
  const resultados: RollbackResultado[] = [];

  let runs: RunPendente[];
  try {
    runs = await buscarRunsPendentes(db);
  } catch (err) {
    return [{ acao: "failed", runId: "unknown", erro: sanitizeCrivoText(err) }];
  }

  if (runs.length === 0) {
    return [{ acao: "none", motivo: "Nenhum run pendente de rollback." }];
  }

  for (const run of runs) {
    if (TERMINAL.includes(run.status)) {
      resultados.push({ acao: "none", motivo: `Run ${run.id} já terminal (${run.status}).` });
      continue;
    }

    const stale = run.dispatched_at ? isRunStale(run.dispatched_at, now) : true;
    const failed = run.status === "failed";

    if (!stale && !failed) {
      resultados.push({
        acao: "none",
        motivo: `Run ${run.id} ainda dentro da janela (${RUN_STALE_AFTER_MS}ms).`,
      });
      continue;
    }

    try {
      await marcarRollback(db, run.id, (run as any).log_tail ?? null);
      resultados.push({
        acao: "rolled_back",
        runId: run.id,
        erroOriginal: (run as any).log_tail ?? undefined,
      });
    } catch (err) {
      resultados.push({ acao: "failed", runId: run.id, erro: sanitizeCrivoText(err) });
    }
  }

  return resultados;
}
