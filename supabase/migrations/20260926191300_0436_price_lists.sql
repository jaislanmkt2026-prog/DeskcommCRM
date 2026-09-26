-- 0436 — tabelas de preço imobiliário
--
-- Suporte a tabelas de preço oficiais de construtoras com versionamento,
-- vigência e compatibilidade com importador Engenharq.
-- Idempotente, portável em psql puro.
--
-- Adições BASE sobre SQL da BALSA §9:
--   1. Função set_updated_at() (se não existir)
--   2. Triggers em real_estate_price_lists e real_estate_price_list_items

-- ─── 0. Função set_updated_at (idempotente) ──────────────────────────────────
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─── 1. real_estate_price_lists ─────────────────────────────────────────────
create table if not exists public.real_estate_price_lists (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  constructor_id uuid not null references public.constructors(id) on delete cascade,
  development_id uuid not null references public.real_estate_developments(id) on delete cascade,
  nome text not null,
  etapa text,
  versao integer not null default 1,
  vigencia_inicio date not null,
  vigencia_fim date,
  fonte text not null default 'manual',
  origem_ref text,
  status text not null default 'ativa' check (status in ('ativa', 'inativa', 'rascunho')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_price_list_org_dev_nome_vigencia
    unique (organization_id, development_id, nome, vigencia_inicio)
);

comment on table public.real_estate_price_lists is
  'Cabeçalho de tabela de preços oficial de construtora (uma por empreendimento/vigência/fonte).';

create index if not exists idx_price_lists_org on public.real_estate_price_lists (organization_id);
create index if not exists idx_price_lists_constructor on public.real_estate_price_lists (constructor_id);
create index if not exists idx_price_lists_development on public.real_estate_price_lists (development_id);
create index if not exists idx_price_lists_status on public.real_estate_price_lists (status);
create index if not exists idx_price_lists_vigencia on public.real_estate_price_lists (vigencia_inicio, vigencia_fim);

-- Trigger updated_at para price_lists
drop trigger if exists trg_price_lists_updated_at on public.real_estate_price_lists;
create trigger trg_price_lists_updated_at
  before update on public.real_estate_price_lists
  for each row execute function public.set_updated_at();

-- ─── 2. real_estate_price_list_items ────────────────────────────────────────
create table if not exists public.real_estate_price_list_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  price_list_id uuid not null references public.real_estate_price_lists(id) on delete cascade,
  unit_id uuid references public.real_estate_units(id) on delete set null,
  valor_cents bigint not null check (valor_cents > 0),
  sinal_cents bigint check (sinal_cents >= 0),
  parcelas jsonb,
  financiamento text,
  condicoes_chaves text,
  status text not null default 'disponivel'
    check (status in ('disponivel', 'reservado', 'vendido', 'bloqueado')),
  quadra text,
  unidade_ref text,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_price_list_item_lista_unidade_ref
    unique (price_list_id, unidade_ref),
  constraint chk_sinal_le_valor check (sinal_cents is null or sinal_cents <= valor_cents)
);

comment on table public.real_estate_price_list_items is
  'Linhas individuais de uma tabela de preços (uma por unidade/condição de pagamento).';

create index if not exists idx_price_list_items_org on public.real_estate_price_list_items (organization_id);
create index if not exists idx_price_list_items_list on public.real_estate_price_list_items (price_list_id);
create index if not exists idx_price_list_items_unit on public.real_estate_price_list_items (unit_id);
create index if not exists idx_price_list_items_status on public.real_estate_price_list_items (status);

-- Trigger updated_at para price_list_items
drop trigger if exists trg_price_list_items_updated_at on public.real_estate_price_list_items;
create trigger trg_price_list_items_updated_at
  before update on public.real_estate_price_list_items
  for each row execute function public.set_updated_at();

-- ─── 3. RLS ─────────────────────────────────────────────────────────────────
alter table public.real_estate_price_lists enable row level security;
drop policy if exists "tenant_isolation_real_estate_price_lists_all" on public.real_estate_price_lists;
create policy "tenant_isolation_real_estate_price_lists_all" on public.real_estate_price_lists
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

alter table public.real_estate_price_list_items enable row level security;
drop policy if exists "tenant_isolation_real_estate_price_list_items_all" on public.real_estate_price_list_items;
create policy "tenant_isolation_real_estate_price_list_items_all" on public.real_estate_price_list_items
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));

-- ─── 4. FK idempotente: property_proposals.price_list_id → real_estate_price_lists ──
-- Adicionada aqui porque property_proposals é criada em 0434_property_proposals_reservations
-- (timestamp anterior), mas a tabela real_estate_price_lists só existe após esta migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'property_proposals'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'property_proposals'
      AND c.conname = 'property_proposals_price_list_id_fkey'
  ) THEN
    alter table public.property_proposals`r`n      add constraint property_proposals_price_list_id_fkey
      FOREIGN KEY (price_list_id) REFERENCES public.real_estate_price_lists(id)
      ON DELETE SET NULL;
  END IF;
END $$;