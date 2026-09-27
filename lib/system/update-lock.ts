/**
 * Lock exclusivo para aplicação supervisionada (Missão 7.4).
 *
 * Mecanismo: tabela `system_update_locks` com TTL 30min renovável.
 * Aquisição via INSERT ON CONFLICT DO NOTHING + verificação de expiry.
 * Liberação explícita em sucesso OU falha.
 *
 * Fonte: VIGIA §3, NÚCLEO §1.3, OPERADOR §4.1
 */
import { createClient } from "@supabase/supabase-js";

const LOCK_TTL_MINUTES = 30;
const LOCK_NAME = "crm_main_update";

export interface LockStatus {
  locked: boolean;
  holder?: string;
  acquiredAt?: string;
  expiresAt?: string;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY obrigatórios",
    );
  }
  return createClient(url, key);
}

/**
 * Adquire lock exclusivo. Retorna true se adquirido, false se já existe lock válido.
 *
 * B3 FIX: Após migration 0438, UNIQUE constraint em lock_name foi substituída por
 * índice parcial (WHERE released_at IS NULL). Isso permite nova aquisição após release.
 * A lógica abaixo insere nova linha a cada aquisição; o índice parcial garante que
 * apenas uma linha com released_at IS NULL exista por lock_name.
 */
export async function acquireUpdateLock(
  correlationId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  const expiresAt = new Date(
    Date.now() + LOCK_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  // Verifica primeiro se existe lock ativo (não expirado)
  const { data: activeLock } = await supabase
    .from("system_update_locks")
    .select("*")
    .eq("lock_name", LOCK_NAME)
    .is("released_at", null)
    .single();

  if (activeLock) {
    const expired = new Date(activeLock.expires_at) < new Date();
    if (!expired) return false; // Lock válido existe — rejeitar

    // Lock stale — liberar antes de tentar adquirir
    await releaseStaleLock(LOCK_NAME);
  }

  // Inserir novo lock (índice parcial garante exclusividade)
  const { error } = await supabase.from("system_update_locks").insert({
    lock_name: LOCK_NAME,
    locked_by: correlationId,
    locked_at: new Date().toISOString(),
    expires_at: expiresAt,
    released_at: null,
  });

  return !error;
}

/**
 * Libera lock explicitamente (sucesso ou falha).
 */
export async function releaseUpdateLock(
  correlationId: string,
): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("system_update_locks")
    .update({ released_at: new Date().toISOString() })
    .eq("lock_name", LOCK_NAME)
    .eq("locked_by", correlationId)
    .is("released_at", null);
}

/**
 * Renova TTL do lock (chamar a cada 5min durante update ativo).
 */
export async function renewUpdateLock(
  correlationId: string,
): Promise<boolean> {
  const supabase = getSupabase();
  const expiresAt = new Date(
    Date.now() + LOCK_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  const { error } = await supabase
    .from("system_update_locks")
    .update({ expires_at: expiresAt })
    .eq("lock_name", LOCK_NAME)
    .eq("locked_by", correlationId)
    .is("released_at", null);

  return !error;
}

/**
 * Verifica status atual do lock.
 */
export async function getLockStatus(): Promise<LockStatus> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("system_update_locks")
    .select("*")
    .eq("lock_name", LOCK_NAME)
    .is("released_at", null)
    .order("locked_at", { ascending: false })
    .limit(1)
    .single();

  if (!data) return { locked: false };

  const expired = new Date(data.expires_at) < new Date();
  if (expired) return { locked: false };

  return {
    locked: true,
    holder: data.locked_by,
    acquiredAt: data.locked_at,
    expiresAt: data.expires_at,
  };
}

/**
 * Limpa locks expirados (job periódico a cada 2min).
 */
export async function cleanupExpiredLocks(): Promise<number> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { data: staleLocks } = await supabase
    .from("system_update_locks")
    .select("id")
    .lt("expires_at", now)
    .is("released_at", null);

  if (!staleLocks || staleLocks.length === 0) return 0;

  const ids = staleLocks.map((l) => l.id);
  await supabase
    .from("system_update_locks")
    .update({ released_at: now })
    .in("id", ids);

  return ids.length;
}

async function releaseStaleLock(lockName: string): Promise<void> {
  const supabase = getSupabase();
  await supabase
    .from("system_update_locks")
    .update({ released_at: new Date().toISOString() })
    .eq("lock_name", lockName)
    .is("released_at", null);
}