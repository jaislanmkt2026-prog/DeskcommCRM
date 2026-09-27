-- 0438: Corrigir reutilização de locks (Blocker B3)
-- Remove UNIQUE constraint em lock_name que impedia nova aquisição após release.
-- Adiciona índice parcial UNIQUE apenas para locks ativos (released_at IS NULL).
-- Fonte: AUDITORIA_EXTERNA_REPROVACAO_7_4.md §B3, DADOS.md §9

-- Remover constraint UNIQUE original
ALTER TABLE public.system_update_locks DROP CONSTRAINT IF EXISTS system_update_locks_lock_name_key;

-- Criar índice parcial UNIQUE: apenas um lock ativo por nome
CREATE UNIQUE INDEX IF NOT EXISTS idx_system_update_locks_active_unique
ON public.system_update_locks (lock_name)
WHERE released_at IS NULL;

COMMENT ON INDEX public.idx_system_update_locks_active_unique IS
'Garante exclusividade apenas para locks ativos; permite reaquisição após release.';