-- Migration: 20260922215820_0383_property_proposals_reservations
-- Created: 2026-09-22T21:58:20Z
-- Purpose: Criar tabelas property_proposals e property_reservations para fechar ciclo de negociação imobiliária
-- Status: CORREÇÃO MISSÃO 8G — RLS corrigido, updated_at adicionado, FK price_list_id removida (aplicação futura via 0383_price_lists)
-- NOTE: Esta migration NÃO cria FK para real_estate_price_lists porque essa tabela é criada
--       posteriormente em 20260923010000_0383_price_lists.sql. A FK será adicionada lá de forma idempotente.

BEGIN;

-- ============================================================================
-- 1. Tabela property_proposals
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.property_proposals (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    client_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    price_list_id uuid, -- FK adicionada posteriormente por 0383_price_lists
    payment_composition jsonb NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT property_proposals_pkey PRIMARY KEY (id),
    CONSTRAINT property_proposals_status_check CHECK (status IN ('draft','sent','accepted','rejected','expired')),
    CONSTRAINT property_proposals_client_id_fkey FOREIGN KEY (client_id) REFERENCES public.contacts(id) ON DELETE CASCADE,
    CONSTRAINT property_proposals_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.real_estate_units(id) ON DELETE CASCADE,
    CONSTRAINT property_proposals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proposals_org ON public.property_proposals(organization_id);
CREATE INDEX IF NOT EXISTS idx_proposals_unit ON public.property_proposals(unit_id);
CREATE INDEX IF NOT EXISTS idx_proposals_client ON public.property_proposals(client_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON public.property_proposals(status);

-- Trigger updated_at
DROP TRIGGER IF EXISTS trg_property_proposals_updated_at ON public.property_proposals;
CREATE TRIGGER trg_property_proposals_updated_at
    BEFORE UPDATE ON public.property_proposals
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_set_updated_at();

-- RLS: tenant isolation estrito (sem policies permissivas amplas tipo USING(true))
ALTER TABLE public.property_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_property_proposals_all" ON public.property_proposals;
CREATE POLICY "tenant_isolation_property_proposals_all"
    ON public.property_proposals
    FOR ALL
    USING (organization_id IN (SELECT public.fn_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.fn_user_org_ids()));

-- ============================================================================
-- 2. Tabela property_reservations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.property_reservations (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL,
    proposal_id uuid NOT NULL,
    unit_id uuid NOT NULL,
    signal_amount_cents bigint NOT NULL,
    expires_at timestamptz NOT NULL,
    status text NOT NULL DEFAULT 'active',
    documents jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT property_reservations_pkey PRIMARY KEY (id),
    CONSTRAINT property_reservations_signal_amount_check CHECK (signal_amount_cents >= 0),
    CONSTRAINT property_reservations_status_check CHECK (status IN ('active','cancelled','expired','converted')),
    CONSTRAINT property_reservations_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.property_proposals(id) ON DELETE CASCADE,
    CONSTRAINT property_reservations_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.real_estate_units(id) ON DELETE CASCADE,
    CONSTRAINT property_reservations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reservations_org ON public.property_reservations(organization_id);
CREATE INDEX IF NOT EXISTS idx_reservations_unit ON public.property_reservations(unit_id);
CREATE INDEX IF NOT EXISTS idx_reservations_proposal ON public.property_reservations(proposal_id);

-- Constraint UNIQUE parcial: uma reserva ativa por unidade
CREATE UNIQUE INDEX IF NOT EXISTS idx_reservations_one_active_per_unit
    ON public.property_reservations(unit_id)
    WHERE status = 'active';

-- Trigger updated_at (coluna agora declarada explicitamente acima)
DROP TRIGGER IF EXISTS trg_property_reservations_updated_at ON public.property_reservations;
CREATE TRIGGER trg_property_reservations_updated_at
    BEFORE UPDATE ON public.property_reservations
    FOR EACH ROW
    EXECUTE FUNCTION public.fn_set_updated_at();

-- RLS: tenant isolation estrito
ALTER TABLE public.property_reservations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_isolation_property_reservations_all" ON public.property_reservations;
CREATE POLICY "tenant_isolation_property_reservations_all"
    ON public.property_reservations
    FOR ALL
    USING (organization_id IN (SELECT public.fn_user_org_ids()))
    WITH CHECK (organization_id IN (SELECT public.fn_user_org_ids()));

COMMIT;