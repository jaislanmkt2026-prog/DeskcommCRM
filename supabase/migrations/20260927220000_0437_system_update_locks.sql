-- 0437: Tabela de locks para aplicação supervisionada (Missão 7.4)
-- Fonte: VIGIA §3, NÚCLEO §1.3, OPERADOR §4.1

CREATE TABLE IF NOT EXISTS public.system_update_locks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    lock_name text NOT NULL UNIQUE,
    locked_by text NOT NULL,
    locked_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    released_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_system_update_locks_active
    ON public.system_update_locks (lock_name)
    WHERE released_at IS NULL;

COMMENT ON TABLE public.system_update_locks IS
    'Locks exclusivos para aplicação supervisionada. TTL 30min renovável.';