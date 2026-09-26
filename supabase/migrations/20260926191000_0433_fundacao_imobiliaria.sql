-- 0382 — fundação imobiliária
--
-- Épico imobiliário: schema completo para construtoras, empreendimentos, unidades,
-- histórico de unidades, imóveis de terceiros (captação), proprietários, documentos
-- e negociações. Tudo tenant-scoped com RLS via fn_user_org_ids().
--
-- Idempotente, portável em psql puro (sem BEGIN/COMMIT, sem temp tables).

-- ─── 1. constructors ───────────────────────────────────────────────────────
create table if not exists public.constructors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  portal text,
  tipo_integracao text check (tipo_integracao in ('api', 'csv', 'manual', 'nenhuma')),
  observacoes text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.constructors is 'Construtoras parceiras da organização (cadastro, sem integração ativa por default).';
create index if not exists idx_constructors_org on public.constructors (organization_id);

-- ─── 2. real_estate_developments ───────────────────────────────────────────
create table if not exists public.real_estate_developments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  constructor_id uuid not null references public.constructors(id) on delete cascade,
  nome text not null,
  localizacao text,
  bairro text,
  cidade text,
  descricao text,
  diferenciais text[],
  fotos text[],
  documentos text[],
  status text not null default 'em_andamento' check (status in ('planejamento', 'em_andamento', 'concluido', 'pausado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.real_estate_developments is 'Empreendimentos de uma construtora (condomínio, prédio, loteamento).';
create index if not exists idx_developments_org on public.real_estate_developments (organization_id);
create index if not exists idx_developments_constructor on public.real_estate_developments (constructor_id);

-- ─── 3. real_estate_units ──────────────────────────────────────────────────
create table if not exists public.real_estate_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  development_id uuid not null references public.real_estate_developments(id) on delete cascade,
  bloco text,
  numero text not null,
  andar integer,
  metragem numeric,
  quartos integer,
  suites integer,
  vagas integer,
  valor_cents bigint,
  condicoes text,
  status text not null default 'disponivel' check (status in ('disponivel', 'reservado', 'vendido', 'bloqueado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (development_id, bloco, numero)
);
comment on table public.real_estate_units is 'Unidades individuais de um empreendimento (apartamento, casa, sala).';
create index if not exists idx_units_org on public.real_estate_units (organization_id);
create index if not exists idx_units_development on public.real_estate_units (development_id);

-- ─── 4. real_estate_history ────────────────────────────────────────────────
create table if not exists public.real_estate_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid not null references public.real_estate_units(id) on delete cascade,
  campo text not null,
  valor_anterior text,
  valor_novo text,
  fonte text,
  registrado_em timestamptz not null default now()
);
comment on table public.real_estate_history is 'Log de mudanças de status/valor de uma unidade (auditoria do funil imobiliário).';
create index if not exists idx_history_org on public.real_estate_history (organization_id);
create index if not exists idx_history_unit on public.real_estate_history (unit_id);

-- ─── 5. third_party_properties ─────────────────────────────────────────────
create table if not exists public.third_party_properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owner_id uuid references public.owners(id) on delete cascade,
  endereco text,
  tipo text,
  caracteristicas text,
  fotos text[],
  valor_desejado_cents bigint,
  status_captacao text not null default 'novo_contato' check (status_captacao in ('novo_contato', 'analise', 'captado', 'divulgado', 'vendido')),
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.third_party_properties is 'Imóveis de terceiros captados pela organização (SOMENTE VENDA, não aluguel).';
create index if not exists idx_third_party_org on public.third_party_properties (organization_id);
create index if not exists idx_third_party_owner on public.third_party_properties (owner_id);

-- ─── 6. owners ─────────────────────────────────────────────────────────────
create table if not exists public.owners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  nome text not null,
  telefone text,
  email text,
  documentos jsonb,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.owners is 'Proprietários de imóveis captados (pode ser o próprio contact ou alguém externo).';
create index if not exists idx_owners_org on public.owners (organization_id);

-- ─── 7. documents ──────────────────────────────────────────────────────────
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  entity_kind text not null check (entity_kind in ('unit', 'third_party_property', 'negotiation')),
  entity_id uuid not null,
  tipo text not null check (tipo in ('matricula', 'escritura', 'iptu', 'contrato', 'pdf', 'imagem')),
  storage_path text not null,
  observacoes text,
  created_at timestamptz not null default now()
);
comment on table public.documents is 'Documentos anexados a entidades imobiliárias (sem validação jurídica automática).';
create index if not exists idx_documents_org on public.documents (organization_id);
create index if not exists idx_documents_entity on public.documents (entity_kind, entity_id);

-- ─── 8. negotiations ───────────────────────────────────────────────────────
create table if not exists public.negotiations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  unidade_id uuid references public.real_estate_units(id) on delete set null,
  imovel_terceiros_id uuid references public.third_party_properties(id) on delete set null,
  responsavel_contact_id uuid references public.contacts(id) on delete set null,
  estagio text not null default 'interesse' check (estagio in ('interesse', 'visita', 'proposta', 'negociacao', 'fechado', 'perdido')),
  valor_cents bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.negotiations is 'Negociações de venda vinculadas a um contato e a uma unidade (própria ou de terceiro).';
create index if not exists idx_negotiations_org on public.negotiations (organization_id);
create index if not exists idx_negotiations_contact on public.negotiations (contact_id);
create index if not exists idx_negotiations_unit on public.negotiations (unidade_id);
create index if not exists idx_negotiations_third_party on public.negotiations (imovel_terceiros_id);

-- ─── RLS em TODAS as tabelas ───────────────────────────────────────────────
-- Padrão: org-scope via fn_user_org_ids() (mesmo das tabelas crm_*).

alter table public.constructors enable row level security;
drop policy if exists "tenant_isolation_constructors_all" on public.constructors;
create policy "tenant_isolation_constructors_all" on public.constructors
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

alter table public.real_estate_developments enable row level security;
drop policy if exists "tenant_isolation_real_estate_developments_all" on public.real_estate_developments;
create policy "tenant_isolation_real_estate_developments_all" on public.real_estate_developments
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

alter table public.real_estate_units enable row level security;
drop policy if exists "tenant_isolation_real_estate_units_all" on public.real_estate_units;
create policy "tenant_isolation_real_estate_units_all" on public.real_estate_units
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

alter table public.real_estate_history enable row level security;
drop policy if exists "tenant_isolation_real_estate_history_all" on public.real_estate_history;
create policy "tenant_isolation_real_estate_history_all" on public.real_estate_history
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

alter table public.third_party_properties enable row level security;
drop policy if exists "tenant_isolation_third_party_properties_all" on public.third_party_properties;
create policy "tenant_isolation_third_party_properties_all" on public.third_party_properties
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

alter table public.owners enable row level security;
drop policy if exists "tenant_isolation_owners_all" on public.owners;
create policy "tenant_isolation_owners_all" on public.owners
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

alter table public.documents enable row level security;
drop policy if exists "tenant_isolation_documents_all" on public.documents;
create policy "tenant_isolation_documents_all" on public.documents
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

alter table public.negotiations enable row level security;
drop policy if exists "tenant_isolation_negotiations_all" on public.negotiations;
create policy "tenant_isolation_negotiations_all" on public.negotiations
  for all using (organization_id in (select public.fn_user_org_ids())) with check (organization_id in (select public.fn_user_org_ids()));

-- ─── Seed: construtoras padrão ─────────────────────────────────────────────
-- Cadastro inicial (sem integração ativa). Idempotente via DO block.

do $seed_constructors$
begin
  insert into public.constructors (organization_id, nome, tipo_integracao, ativo)
  select
    o.id,
    c.nome,
    'nenhuma',
    true
  from public.organizations o
  cross join (
    values
      ('Engenharq'),
      ('Telesil'),
      ('Rocha'),
      ('MRV'),
      ('Solidez')
  ) c(nome)
  where not exists (
    select 1 from public.constructors existing
    where existing.organization_id = o.id and existing.nome = c.nome
  );
end
$seed_constructors$;

-- ─── Colunas de interesse imobiliário em contacts ──────────────────────────
alter table public.contacts
  add column if not exists interesse_imobiliario text,
  add column if not exists empreendimento_interesse text,
  add column if not exists imoveis_apresentados jsonb not null default '[]'::jsonb;

comment on column public.contacts.interesse_imobiliario is 'Flag de interesse do contato em produto imobiliário (ex.: "compra", "investimento", "financiamento").';
comment on column public.contacts.empreendimento_interesse is 'Nome ou ID do empreendimento de interesse do contato.';
comment on column public.contacts.imoveis_apresentados is 'Lista de unidades/imóveis já apresentados ao contato (histórico de abordagem).';