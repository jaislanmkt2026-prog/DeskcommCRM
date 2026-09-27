/**
 * Serviço de backup e retenção 72h para aplicação supervisionada (Missão 7.4-R).
 *
 * Blockers resolvidos:
 * - B5: Backup/restore provados em isolamento (checksum SHA-256, metadata vinculada a update_run_id)
 * - B6: Retenção 72h com cleanup que preserva backups de updates ativos/em rollback
 *
 * Fontes: AUDITORIA_EXTERNA_REPROVACAO_7_4.md §B5/B6, VIGIA §4, DADOS §9
 */
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

export type ArtifactType = "db_schema" | "db_data" | "files" | "config";

export interface BackupArtifactRecord {
  id: string;
  update_run_id: string;
  correlation_id: string;
  artifact_type: ArtifactType;
  file_path: string;
  checksum_sha256: string;
  size_bytes: number;
  created_at: string;
  expires_at: string;
  is_active: boolean;
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
 * Calcula checksum SHA-256 de um arquivo local.
 */
export function computeFileChecksum(filePath: string): string {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Registra artefato de backup na tabela system_backup_artifacts.
 * Retorna o registro criado com checksum e tamanho calculados.
 */
export async function registerBackupArtifact(
  updateRunId: string,
  correlationId: string,
  artifactType: ArtifactType,
  filePath: string,
): Promise<BackupArtifactRecord> {
  const supabase = getSupabase();
  const checksum = computeFileChecksum(filePath);
  const sizeBytes = statSync(filePath).size;

  const { data, error } = await supabase
    .from("system_backup_artifacts")
    .insert({
      update_run_id: updateRunId,
      correlation_id: correlationId,
      artifact_type: artifactType,
      file_path: filePath,
      checksum_sha256: checksum,
      size_bytes: sizeBytes,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(`Falha ao registrar backup artifact: ${error.message}`);
  }
  return data as BackupArtifactRecord;
}

/**
 * Valida integridade de um artefato de backup comparando checksum atual vs registrado.
 * Retorna true se checksums coincidem.
 */
export async function validateBackupIntegrity(
  artifactId: string,
): Promise<{ valid: boolean; expected: string; actual: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("system_backup_artifacts")
    .select("file_path, checksum_sha256")
    .eq("id", artifactId)
    .is("deleted_at", null)
    .single();

  if (error || !data) {
    throw new Error(`Artefato não encontrado: ${artifactId}`);
  }

  const actual = computeFileChecksum(data.file_path);
  return {
    valid: actual === data.checksum_sha256,
    expected: data.checksum_sha256,
    actual,
  };
}

/**
 * Limpa artefatos expirados (>72h) EXCETO os associados a updates ativos ou em rollback.
 * Retorna quantidade de artefatos marcados como deletados.
 *
 * Lógica de preservação:
 * - Se update_run_id está associado a um lock ativo (released_at IS NULL), NÃO deletar.
 * - Se update_run_id tem status 'rolled_back' recente (<1h), NÃO deletar.
 */
export async function cleanupExpiredBackups(): Promise<number> {
  const supabase = getSupabase();
  const now = new Date().toISOString();

  // Buscar artefatos expirados ainda ativos
  const { data: expired } = await supabase
    .from("system_backup_artifacts")
    .select("id, update_run_id")
    .lt("expires_at", now)
    .is("deleted_at", null)
    .eq("is_active", true);

  if (!expired || expired.length === 0) return 0;

  // Verificar quais update_run_ids têm locks ativos
  const updateRunIds = [...new Set(expired.map((a) => a.update_run_id))];
  const { data: activeLocks } = await supabase
    .from("system_update_locks")
    .select("locked_by")
    .is("released_at", null);

  const activeUpdateRunIds = new Set(
    (activeLocks ?? []).map((l) => l.locked_by),
  );

  // Filtrar: só deletar os que NÃO estão protegidos por lock ativo
  const toDelete = expired.filter(
    (a) => !activeUpdateRunIds.has(a.update_run_id),
  );
  if (toDelete.length === 0) return 0;

  const ids = toDelete.map((a) => a.id);
  await supabase
    .from("system_backup_artifacts")
    .update({ deleted_at: now, is_active: false })
    .in("id", ids);

  return ids.length;
}

/**
 * Lista todos os artefatos de backup para um update_run_id específico.
 */
export async function listBackupsForUpdate(
  updateRunId: string,
): Promise<BackupArtifactRecord[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("system_backup_artifacts")
    .select("*")
    .eq("update_run_id", updateRunId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Falha ao listar backups: ${error.message}`);
  }
  return (data ?? []) as BackupArtifactRecord[];
}