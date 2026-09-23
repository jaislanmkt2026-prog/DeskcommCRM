-- Migration: 0384_property_proposals_reservations_history
-- Created: 2026-09-22T22:00:00Z
-- Purpose: Criar tabelas de histórico para property_proposals e property_reservations
-- Rollback: DROP TABLE IF EXISTS public.property_reservations_history CASCADE; DROP TABLE IF EXISTS public.property_proposals_history CASCADE; DROP FUNCTION IF EXISTS public.fn_track_proposal_reservation_history CASCADE;
BEGIN;

-- ============================================================================
-- 1. Tabela property_proposals_history
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.property_proposals_history (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    parent_id uuid NOT NULL,
    changed_by uuid,
    changed_at timestamptz NOT NULL DEFAULT now(),
    old_values jsonb,
    new_values jsonb,
    operation text NOT NULL,
    CONSTRAINT property_proposals_history_pkey PRIMARY KEY (id),
    CONSTRAINT property_proposals_history_operation_check CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    CONSTRAINT property_proposals_history_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.property_proposals(id) ON DELETE CASCADE,
    CONSTRAINT property_proposals_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_proposals_history_parent ON public.property_proposals_history(parent_id);
CREATE INDEX IF NOT EXISTS idx_proposals_history_changed_at ON public.property_proposals_history(changed_at);

-- RLS
ALTER TABLE public.property_proposals_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "tenant_isolation_proposals_history_all"
    ON public.property_proposals_history
    USING (EXISTS (
        SELECT 1 FROM public.property_proposals p
        WHERE p.id = parent_id
        AND p.organization_id IN (SELECT fn_user_org_ids())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.property_proposals p
        WHERE p.id = parent_id
        AND p.organization_id IN (SELECT fn_user_org_ids())
    ));

-- ============================================================================
-- 2. Tabela property_reservations_history
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.property_reservations_history (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    parent_id uuid NOT NULL,
    changed_by uuid,
    changed_at timestamptz NOT NULL DEFAULT now(),
    old_values jsonb,
    new_values jsonb,
    operation text NOT NULL,
    CONSTRAINT property_reservations_history_pkey PRIMARY KEY (id),
    CONSTRAINT property_reservations_history_operation_check CHECK (operation IN ('INSERT','UPDATE','DELETE')),
    CONSTRAINT property_reservations_history_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.property_reservations(id) ON DELETE CASCADE,
    CONSTRAINT property_reservations_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reservations_history_parent ON public.property_reservations_history(parent_id);
CREATE INDEX IF NOT EXISTS idx_reservations_history_changed_at ON public.property_reservations_history(changed_at);

-- RLS
ALTER TABLE public.property_reservations_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "tenant_isolation_reservations_history_all"
    ON public.property_reservations_history
    USING (EXISTS (
        SELECT 1 FROM public.property_reservations r
        WHERE r.id = parent_id
        AND r.organization_id IN (SELECT fn_user_org_ids())
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.property_reservations r
        WHERE r.id = parent_id
        AND r.organization_id IN (SELECT fn_user_org_ids())
    ));

-- ============================================================================
-- 3. Função de tracking de histórico
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_track_proposal_reservation_history()
RETURNS trigger AS $$
DECLARE
    v_old_values jsonb;
    v_new_values jsonb;
    v_operation text;
    v_history_table text;
BEGIN
    -- Determina operação
    IF TG_OP = 'INSERT' THEN
        v_operation := 'INSERT';
        v_old_values := NULL;
        v_new_values := to_jsonb(NEW);
        v_history_table := TG_ARGV[0];
    ELSIF TG_OP = 'UPDATE' THEN
        v_operation := 'UPDATE';
        v_old_values := to_jsonb(OLD);
        v_new_values := to_jsonb(NEW);
        v_history_table := TG_ARGV[0];
    ELSIF TG_OP = 'DELETE' THEN
        v_operation := 'DELETE';
        v_old_values := to_jsonb(OLD);
        v_new_values := NULL;
        v_history_table := TG_ARGV[0];
    END IF;

    -- Insere na tabela de histórico apropriada
    IF v_history_table = 'property_proposals_history' THEN
        INSERT INTO public.property_proposals_history (parent_id, changed_by, changed_at, old_values, new_values, operation)
        VALUES (COALESCE(NEW.id, OLD.id), auth.uid(), now(), v_old_values, v_new_values, v_operation);
    ELSIF v_history_table = 'property_reservations_history' THEN
        INSERT INTO public.property_reservations_history (parent_id, changed_by, changed_at, old_values, new_values, operation)
        VALUES (COALESCE(NEW.id, OLD.id), auth.uid(), now(), v_old_values, v_new_values, v_operation);
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Triggers em property_proposals
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_property_proposals_history_insert
    AFTER INSERT ON public.property_proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_track_proposal_reservation_history('property_proposals_history');

CREATE TRIGGER IF NOT EXISTS trg_property_proposals_history_update
    AFTER UPDATE ON public.property_proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_track_proposal_reservation_history('property_proposals_history');

CREATE TRIGGER IF NOT EXISTS trg_property_proposals_history_delete
    AFTER DELETE ON public.property_proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_track_proposal_reservation_history('property_proposals_history');

-- ============================================================================
-- 5. Triggers em property_reservations
-- ============================================================================
CREATE TRIGGER IF NOT EXISTS trg_property_reservations_history_insert
    AFTER INSERT ON public.property_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_track_proposal_reservation_history('property_reservations_history');

CREATE TRIGGER IF NOT EXISTS trg_property_reservations_history_update
    AFTER UPDATE ON public.property_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_track_proposal_reservation_history('property_reservations_history');

CREATE TRIGGER IF NOT EXISTS trg_property_reservations_history_delete
    AFTER DELETE ON public.property_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_track_proposal_reservation_history('property_reservations_history');

COMMIT;