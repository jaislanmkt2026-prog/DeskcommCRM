/**
 * P1-C Missão 7.7 — Alertas de exceção do Crivo.
 *
 * Notifica o dono (via agent_inbox_items) quando o ciclo falha ou bloqueia
 * por motivo real (risco ALTO, análise incompleta, production sem approval,
 * kill switch, rollback executado). Dedup por ref_kind: enquanto houver item
 * aberto com o mesmo ref_kind, avaliações novas não duplicam — humano resolve
 * fecha o episódio. Mesma semântica de evaluateCacheHitAlert em obs/metrics.ts.
 *
 * Contrato: chamada após executarCicloCrivo ou executarRollbackSeNecessario;
 * recebe o resultado e decide se alerta. Não altera estado do upstream/runs.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import type { CicloResultado } from "@/lib/system/crivo-cycle";
import type { RollbackResultado } from "@/lib/system/crivo-rollback";

type AdminClient = ReturnType<typeof createAdminClient>;

export const CRIVO_ALERT_REF_KIND = "crivo_cycle_exception";

export interface CrivoAlertResult {
  alerted: boolean;
  motivo: string | null;
}

function tituloDoBloqueio(resultado: CicloResultado): string | null {
  if (resultado.fase === "blocked") return `Crivo bloqueado: ${resultado.motivo}`;
  if (resultado.fase === "failed") return `Crivo falhou: ${resultado.erro}`;
  return null;
}

function corpoDoBloqueio(resultado: CicloResultado): string | null {
  if (resultado.fase === "blocked") {
    const risco = resultado.risco ? ` Risco: ${resultado.risco.toUpperCase()}.` : "";
    return `${resultado.motivo}${risco} Revisão humana necessária antes de prosseguir.`;
  }
  if (resultado.fase === "failed") {
    return `Erro no ciclo Crivo: ${resultado.erro}. Verifique logs e estado do system_upstream_state.`;
  }
  return null;
}

export async function alertarExcecaoCrivo(
  db: AdminClient,
  ciclo: CicloResultado,
  rollbacks?: RollbackResultado[],
): Promise<CrivoAlertResult> {
  const titulo = tituloDoBloqueio(ciclo);
  const corpo = corpoDoBloqueio(ciclo);
  const houveRollback = rollbacks?.some((r) => r.acao === "rolled_back") ?? false;

  if (!titulo && !houveRollback) {
    return { alerted: false, motivo: null };
  }

  const finalTitulo = titulo ?? "Crivo: rollback automático executado";
  const finalCorpo = houveRollback
    ? `${corpo ?? ""} Rollback automático foi executado para run(s) stale ou falho(s). Verifique system_update_runs.`.trim()
    : (corpo ?? "");

  // organization_id = 1 é a org raiz (mesma convenção de metrics.ts cache alert);
  // Crivo é infra global, não tenant-specific.
  // Dedup: verifica se já existe item aberto com mesmo ref_kind antes de inserir.
  const { data: existente, error: erroSelect } = await db
    .from("agent_inbox_items")
    .select("id")
    .eq("organization_id", 1)
    .eq("ref_kind", CRIVO_ALERT_REF_KIND)
    .eq("status", "open")
    .limit(1);

  if (erroSelect) {
    return { alerted: false, motivo: `Falha ao verificar alerta existente: ${erroSelect.message}` };
  }

  if ((existente?.length ?? 0) > 0) {
    return { alerted: false, motivo: null };
  }

  const { error: erroInsert } = await db.from("agent_inbox_items").insert({
    organization_id: 1,
    kind: "other",
    severity: "warn",
    title: finalTitulo,
    body: finalCorpo,
    ref_kind: CRIVO_ALERT_REF_KIND,
    status: "open",
  });

  if (erroInsert) {
    return { alerted: false, motivo: `Falha ao inserir alerta: ${erroInsert.message}` };
  }

  return { alerted: true, motivo: finalTitulo };
}
