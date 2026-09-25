-- STATUS: DEPRECATED BEFORE APPLY
-- DO NOT APPLY AS-IS
-- MOTIVO: contém arquitetura duplicada de proposal/reservation.
--         A série canônica aprovada é property_proposals / property_reservations
--         (migration 0383). As tabelas real_estate_property_proposals e
--         real_estate_property_reservations desta migration NÃO devem ser criadas.
--         Entidades úteis (credit_analyses, business_plans, reservation_events)
--         podem ser extraídas futuramente em migration própria.
--
-- 0384 — fluxo de negócio imobiliário (pós-handoff)
--
-- Entidades: credit_analyses, business_plans, property_proposals,
--            property_reservations, reservation_events.
-- Todas tenant-scoped com RLS via fn_user_org_ids().
-- Idempotente, portável em psql puro.
--
-- Correções CRIVO aplicadas:
--   T1: organization_id em todas as tabelas
--   T2: RLS policies para todas as tabelas
--   T3: organization_id denormalizado em reservation_events
--   C1: CHECK constraints para todos os enums de status
--   C2: CHECK (bank_status != 'negado' OR approved_amount IS NULL)
--   C3: CHECK cancelled_at coerente com status cancelado
--   C4: UNIQUE (contact_id, title, version) em business_plans
--   F1: proposal_id ON DELETE RESTRICT em reservations
--   F2: credit_analysis_id ON DELETE SET NULL em business_plans
--   F4: reservation_id ON DELETE CASCADE em reservation_events
--   H1: Trigger set_updated_at() em todas as tabelas mutáveis
--   N1: FKs para real_estate_units e real_estate_property_proposals corretas

-- ─── 1. real_estate_credit_analyses ──────────────────────────────────────────
create table if not exists public.real_estate_credit_analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  analyst text not null,
  source text not null check (source in ('caixa_simulador', 'correspondente_api', 'manual')),
  simulation_date date not null,
  approved_amount numeric(15,2),
  requested_amount numeric(15,2) not null,
  interest_rate numeric(6,4),
  term_months integer,
  amortization_system text check (amortization_system in ('sac', 'price', 'outro')),
  monthly_payment numeric(15,2),
  income_commitment_pct numeric(5,2),
  bank_status text not null check (bank_status in ('pre_aprovado', 'aprovado', 'pendente_documento', 'negado', 'expirado')),
  bank_reference text,
  validity_until date,
  observations text,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_credit_negado_sem_valor check (bank_status != 'negado' or approved_amount is null)
);

comment on table public.real_estate_credit_analyses is
  'Análises de crédito de leads (simulações Caixa, correspondentes, manual).';

create index if not exists idx_credit_analyses_org on public.real_estate_credit_analyses (organization_id);
create index if not exists idx_credit_analyses_contact on public.real_estate_credit_analyses (contact_id);
create index if not exists idx_credit_analyses_bank_status on public.real_estate_credit_analyses (bank_status);
create index if not exists idx_credit_analyses_simulation_date on public.real_estate_credit_analyses (simulation_date);

drop trigger if exists trg_credit_analyses_updated_at on public.real_estate_credit_analyses;
create trigger trg_credit_analyses_updated_at
  before update on public.real_estate_credit_analyses
  for each row execute function public.set_updated_at();

alter table public.real_estate_credit_analyses enable row level security;
drop policy if exists "tenant_isolation_real_estate_credit_analyses_all" on public.real_estate_credit_analyses;
create policy "tenant_isolation_real_estate_credit_analyses_all" on public.real_estate_credit_analyses
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- ─── 2. real_estate_business_plans ───────────────────────────────────────────
create table if not exists public.real_estate_business_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  credit_analysis_id uuid references public.real_estate_credit_analyses(id) on delete set null,
  version integer not null default 1,
  title text not null,
  property_value numeric(15,2) not null,
  down_payment numeric(15,2) not null,
  financed_amount numeric(15,2) not null,
  fgts_usage numeric(15,2),
  subsidy_estimate numeric(15,2),
  monthly_payment_target numeric(15,2),
  notes text,
  meeting_date date,
  client_feedback text,
  status text not null default 'rascunho' check (status in ('rascunho', 'apresentado', 'ajustando', 'aceito', 'descartado')),
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_business_plan_contact_title_version unique (contact_id, title, version)
);

comment on table public.real_estate_business_plans is
  'Planos de negócio apresentados ao lead (versionados por contato).';

create index if not exists idx_business_plans_org on public.real_estate_business_plans (organization_id);
create index if not exists idx_business_plans_contact on public.real_estate_business_plans (contact_id);
create index if not exists idx_business_plans_status on public.real_estate_business_plans (status);

drop trigger if exists trg_business_plans_updated_at on public.real_estate_business_plans;
create trigger trg_business_plans_updated_at
  before update on public.real_estate_business_plans
  for each row execute function public.set_updated_at();

alter table public.real_estate_business_plans enable row level security;
drop policy if exists "tenant_isolation_real_estate_business_plans_all" on public.real_estate_business_plans;
create policy "tenant_isolation_real_estate_business_plans_all" on public.real_estate_business_plans
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- ─── 3. real_estate_property_proposals ───────────────────────────────────────
create table if not exists public.real_estate_property_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  business_plan_id uuid references public.real_estate_business_plans(id) on delete set null,
  unit_id uuid not null references public.real_estate_units(id) on delete restrict,
  proposer text not null,
  proposal_date date not null,
  offered_price numeric(15,2) not null,
  payment_conditions jsonb not null,
  validity_until date not null,
  status text not null default 'minuta' check (status in ('minuta', 'enviada', 'negociando', 'aceita', 'recusada', 'expirada', 'cancelada')),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.real_estate_property_proposals is
  'Propostas formais enviadas ao lead para uma unidade específica.';

create index if not exists idx_proposals_org on public.real_estate_property_proposals (organization_id);
create index if not exists idx_proposals_contact on public.real_estate_property_proposals (contact_id);
create index if not exists idx_proposals_unit on public.real_estate_property_proposals (unit_id);
create index if not exists idx_proposals_status on public.real_estate_property_proposals (status);
create index if not exists idx_proposals_validity on public.real_estate_property_proposals (validity_until);

drop trigger if exists trg_proposals_updated_at on public.real_estate_property_proposals;
create trigger trg_proposals_updated_at
  before update on public.real_estate_property_proposals
  for each row execute function public.set_updated_at();

alter table public.real_estate_property_proposals enable row level security;
drop policy if exists "tenant_isolation_real_estate_property_proposals_all" on public.real_estate_property_proposals;
create policy "tenant_isolation_real_estate_property_proposals_all" on public.real_estate_property_proposals
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- ─── 4. real_estate_property_reservations ────────────────────────────────────
create table if not exists public.real_estate_property_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  proposal_id uuid not null references public.real_estate_property_proposals(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  unit_id uuid not null references public.real_estate_units(id) on delete restrict,
  reserved_by text not null,
  reservation_date date not null,
  validity_until date not null,
  deposit_amount numeric(15,2),
  deposit_receipt text,
  builder_reference text,
  cancellation_reason text,
  cancelled_at timestamptz,
  status text not null default 'ativa' check (status in ('ativa', 'expirada', 'cancelada_cliente', 'cancelada_construtora', 'convertida_contrato')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chk_reservation_cancelled_at_coherent check (
    (status in ('cancelada_cliente', 'cancelada_construtora') and cancelled_at is not null)
    or
    (status not in ('cancelada_cliente', 'cancelada_construtora') and cancelled_at is null)
  ),
  constraint uq_reservation_proposal unique (proposal_id)
);

comment on table public.real_estate_property_reservations is
  'Reservas de unidades vinculadas a propostas aceitas (com sinal).';

create index if not exists idx_reservations_org on public.real_estate_property_reservations (organization_id);
create index if not exists idx_reservations_contact on public.real_estate_property_reservations (contact_id);
create index if not exists idx_reservations_unit on public.real_estate_property_reservations (unit_id);
create index if not exists idx_reservations_status on public.real_estate_property_reservations (status);
create index if not exists idx_reservations_validity on public.real_estate_property_reservations (validity_until);

drop trigger if exists trg_reservations_updated_at on public.real_estate_property_reservations;
create trigger trg_reservations_updated_at
  before update on public.real_estate_property_reservations
  for each row execute function public.set_updated_at();

alter table public.real_estate_property_reservations enable row level security;
drop policy if exists "tenant_isolation_real_estate_property_reservations_all" on public.real_estate_property_reservations;
create policy "tenant_isolation_real_estate_property_reservations_all" on public.real_estate_property_reservations
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- ─── 5. real_estate_reservation_events ───────────────────────────────────────
create table if not exists public.real_estate_reservation_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  reservation_id uuid not null references public.real_estate_property_reservations(id) on delete cascade,
  event_type text not null check (event_type in ('criada', 'renovada', 'cancelada', 'expirada', 'convertida')),
  occurred_at timestamptz not null default now(),
  actor text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

comment on table public.real_estate_reservation_events is
  'Log imutável de eventos de reserva (auditoria do ciclo de vida da reserva).';

create index if not exists idx_reservation_events_org on public.real_estate_reservation_events (organization_id);
create index if not exists idx_reservation_events_reservation on public.real_estate_reservation_events (reservation_id);
create index if not exists idx_reservation_events_type on public.real_estate_reservation_events (event_type);
create index if not exists idx_reservation_events_occurred on public.real_estate_reservation_events (occurred_at);

alter table public.real_estate_reservation_events enable row level security;
drop policy if exists "tenant_isolation_real_estate_reservation_events_all" on public.real_estate_reservation_events;
create policy "tenant_isolation_real_estate_reservation_events_all" on public.real_estate_reservation_events
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));