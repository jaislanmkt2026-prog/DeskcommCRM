/**
 * P0-C Missão 8 — Executor físico do Crivo (worker autônomo).
 *
 * Consome system_update_runs com status 'dispatched', executa update.sh/git pull
 * via child_process, valida health-check pós-aplicação e transiciona para
 * 'success' ou 'failed_rolled_back'. Loop contínuo com intervalo configurável.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { sanitizeCrivoText } from "@/lib/system/crivo-control";
import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

interface RunParaExecutar {
  id: string;
  from_version: string | null;
  to_version: string | null;
  crivo_environment: string | null;
  change_fingerprint: string | null;
}

const INTERVALO_MS = parseInt(process.env.CRIVO_EXECUTOR_INTERVAL_MS ?? "30000", 10);
const UPDATE_SCRIPT = process.env.CRIVO_UPDATE_SCRIPT ?? "/app/scripts/update.sh";
const REPO_DIR = process.env.CRIVO_REPO_DIR ?? "/app";

async function buscarRunsParaExecutar(
  db: ReturnType<typeof createAdminClient>,
): Promise<RunParaExecutar[]> {
  const { data, error } = await db
    .from("system_update_runs")
    .select("id,from_version,to_version,crivo_environment,change_fingerprint")
    .eq("status", "dispatched")
    .order("dispatched_at", { ascending: true })
    .limit(5);

  if (error) throw new Error(`Buscar runs: ${error.message}`);
  return (data ?? []) as RunParaExecutar[];
}

async function executarUpdate(run: RunParaExecutar): Promise<{ sucesso: boolean; output: string }> {
  try {
    const cmd = `cd ${REPO_DIR} && ${UPDATE_SCRIPT} --from ${run.from_version ?? ""} --to ${run.to_version ?? ""} --env ${run.crivo_environment ?? "local"}`;
    console.log(`[CrivoExecutor] Executando run ${run.id}: ${cmd}`);

    const { stdout, stderr } = await exec(cmd, { timeout: 300000 });
    const output = stdout + (stderr ? `\nSTDERR: ${stderr}` : "");

    // Health-check básico: verifica se o app responde após update
    try {
      const healthUrl = process.env.HEALTH_CHECK_URL ?? "http://localhost:3000/api/health";
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`Health check falhou: ${res.status}`);
      console.log(`[CrivoExecutor] Run ${run.id} aplicado com sucesso. Health OK.`);
      return { sucesso: true, output };
    } catch (healthErr) {
      console.error(`[CrivoExecutor] Run ${run.id} health-check falhou:`, healthErr);
      return {
        sucesso: false,
        output: `${output}\nHEALTH_CHECK_FAILED: ${sanitizeCrivoText(healthErr)}`,
      };
    }
  } catch (err) {
    console.error(`[CrivoExecutor] Run ${run.id} falha na execução:`, err);
    return { sucesso: false, output: sanitizeCrivoText(err) };
  }
}

async function atualizarStatusRun(
  db: ReturnType<typeof createAdminClient>,
  runId: string,
  sucesso: boolean,
  output: string,
): Promise<void> {
  const now = new Date().toISOString();
  const novoStatus = sucesso ? "success" : "failed";

  await db
    .from("system_update_runs")
    .update({
      status: novoStatus,
      finished_at: now,
      log_tail: output.slice(-2000), // mantém últimos 2k chars do log
    })
    .eq("id", runId)
    .eq("status", "dispatched");
}

export async function iniciarCrivoExecutorWorker(): Promise<void> {
  console.log("[CrivoExecutor] Worker iniciado. Intervalo:", INTERVALO_MS, "ms");
  console.log("[CrivoExecutor] UPDATE_SCRIPT:", UPDATE_SCRIPT);
  console.log("[CrivoExecutor] REPO_DIR:", REPO_DIR);

  while (true) {
    try {
      const db = createAdminClient();
      console.log("[CrivoExecutor] Buscando runs dispatched...");
      const runs = await buscarRunsParaExecutar(db);

      if (runs.length === 0) {
        console.log("[CrivoExecutor] Nenhum run pendente. Aguardando...");
      } else {
        console.log(`[CrivoExecutor] Processando ${runs.length} run(s)...`);
        for (const run of runs) {
          const resultado = await executarUpdate(run);
          await atualizarStatusRun(db, run.id, resultado.sucesso, resultado.output);
          console.log(
            `[CrivoExecutor] Run ${run.id} finalizado: ${resultado.sucesso ? "SUCESSO" : "FALHA"}`,
          );
        }
      }
    } catch (err) {
      console.error("[CrivoExecutor] Erro no ciclo:", err);
    }

    await new Promise((resolve) => setTimeout(resolve, INTERVALO_MS));
  }
}

// Executar se chamado diretamente (tsx/node)
iniciarCrivoExecutorWorker().catch((err) => {
  console.error("[CrivoExecutor] Fatal:", err);
  process.exit(1);
});
