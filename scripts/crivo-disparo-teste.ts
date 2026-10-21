/**
 * Disparo direto do ciclo Crivo para validação end-to-end (sem HTTP).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { executarCicloCrivo } from "@/lib/system/crivo-cycle";
import { executarRollbackSeNecessario } from "@/lib/system/crivo-rollback";
import { alertarExcecaoCrivo } from "@/lib/system/crivo-alerts";

async function main() {
  console.log("[CrivoTeste] Iniciando ciclo...");
  const db = createAdminClient();
  const ciclo = await executarCicloCrivo({ db });
  console.log("[CrivoTeste] Ciclo:", JSON.stringify(ciclo, null, 2));
  const rollbacks = await executarRollbackSeNecessario({ db });
  console.log("[CrivoTeste] Rollbacks:", JSON.stringify(rollbacks, null, 2));
  const alerta = await alertarExcecaoCrivo(db, ciclo, rollbacks);
  console.log("[CrivoTeste] Alerta:", JSON.stringify(alerta, null, 2));
  console.log("[CrivoTeste] Concluído.");
}

main().catch((err) => {
  console.error("[CrivoTeste] Fatal:", err);
  process.exit(1);
});
