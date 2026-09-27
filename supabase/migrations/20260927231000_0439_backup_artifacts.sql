-- 0439: Tabela de metadados de backup com retenção 72h (Blocker B6)
-- Fonte: AUDITORIA_EXTERNA_REPROVACAO_7_4.md §B6, VIGIA §4, DADOS §9

CREATE TABLE IF NOT EXISTS public.system_backup_artifacts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    update_run_id uuid NOT NULL,
    correlation_id uuid NOT NULL,
    artifact_type text NOT NULL CHECK (artifact_type IN ('db_schema', 'db_data', 'files', 'config')),
    file_path text NOT NULL,
    checksum_sha256 text NOT NULL,
    size_bytes bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL DEFAULT (now() + interval '72 hours'),
    deleted_at timestamptz,
    is_active boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_backup_artifacts_active
    ON public.system_backup_artifacts (update_run_id)
    WHERE deleted_at IS NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_backup_artifacts_expiry
    ON public.system_backup_artifacts (expires_at)
    WHERE deleted_at IS NULL;

COMMENT ON TABLE public.system_backup_artifacts IS
    'Metadados de artefatos de backup pré-update. Retenção mínima 72h. Cleanup automático via cleanupExpiredBackups().';