-- 0527 — identidade oficial do CV CRM nas entidades imobiliarias
--
-- Porta semanticamente a Missao 8 sobre o schema atual. A antiga 0386 ficou
-- marcada DEFERRED, mas foi parcialmente materializada em alguns bancos; por
-- isso este forward-fix absorve esse estado sem reativar o arquivo legado.
-- Idempotente e portavel em psql puro.

alter table public.real_estate_developments
  add column if not exists external_id text,
  add column if not exists cv_crm_last_seen_at timestamptz,
  add column if not exists cv_crm_stale_since timestamptz;

alter table public.real_estate_units
  add column if not exists external_id text,
  add column if not exists cv_crm_last_seen_at timestamptz,
  add column if not exists cv_crm_stale_since timestamptz;

alter table public.real_estate_price_lists
  add column if not exists external_id text;

alter table public.real_estate_price_list_items
  add column if not exists external_id text;

-- Cura apenas o estado sem identidade (vazio/branco). IDs nao vazios nunca sao
-- deduplicados por suposicao: conflito real deve falhar alto para nao trocar a
-- identidade oficial de uma unidade silenciosamente.
update public.real_estate_developments
set external_id = null
where external_id is not null and btrim(external_id) = '';

update public.real_estate_units
set external_id = null
where external_id is not null and btrim(external_id) = '';

update public.real_estate_price_lists
set external_id = null
where external_id is not null and btrim(external_id) = '';

update public.real_estate_price_list_items
set external_id = null
where external_id is not null and btrim(external_id) = '';

alter table public.real_estate_developments
  drop constraint if exists chk_developments_external_id_not_blank;
alter table public.real_estate_developments
  add constraint chk_developments_external_id_not_blank
  check (external_id is null or length(btrim(external_id)) > 0);

alter table public.real_estate_units
  drop constraint if exists chk_units_external_id_not_blank;
alter table public.real_estate_units
  add constraint chk_units_external_id_not_blank
  check (external_id is null or length(btrim(external_id)) > 0);
alter table public.real_estate_price_lists
  drop constraint if exists chk_price_lists_external_id_not_blank;
alter table public.real_estate_price_lists
  add constraint chk_price_lists_external_id_not_blank
  check (external_id is null or length(btrim(external_id)) > 0);

alter table public.real_estate_price_list_items
  drop constraint if exists chk_price_list_items_external_id_not_blank;
alter table public.real_estate_price_list_items
  add constraint chk_price_list_items_external_id_not_blank
  check (external_id is null or length(btrim(external_id)) > 0);

create unique index if not exists uq_developments_org_external_id
  on public.real_estate_developments (organization_id, external_id)
  where external_id is not null;

create unique index if not exists uq_units_org_external_id
  on public.real_estate_units (organization_id, external_id)
  where external_id is not null;

create unique index if not exists uq_price_lists_org_external_id
  on public.real_estate_price_lists (organization_id, external_id)
  where external_id is not null;

create unique index if not exists uq_price_list_items_org_external_id
  on public.real_estate_price_list_items (organization_id, external_id)
  where external_id is not null;
-- Indices legados sem organization_id vieram da 0386 DEFERRED. A identidade
-- externa e tenant-scoped; manter lookup global de external_id incentiva query
-- que viola a doutrina multi-tenant e duplica escrita de indice.
drop index if exists public.idx_developments_external_id;
drop index if exists public.idx_units_external_id;

comment on column public.real_estate_developments.external_id is
  'ID do empreendimento no CV CRM, fonte oficial externa. NULL = sem vinculo CV CRM.';
comment on column public.real_estate_units.external_id is
  'ID da unidade no CV CRM, fonte oficial externa. NULL = sem vinculo CV CRM.';
comment on column public.real_estate_price_lists.external_id is
  'ID da tabela de precos no CV CRM. NULL = sem vinculo CV CRM.';
comment on column public.real_estate_price_list_items.external_id is
  'ID do item de preco no CV CRM. NULL = sem vinculo CV CRM.';

comment on column public.real_estate_developments.cv_crm_last_seen_at is
  'Ultima vez que o CV CRM retornou este empreendimento na sincronizacao.';
comment on column public.real_estate_developments.cv_crm_stale_since is
  'Desde quando o CV CRM deixou de retornar este empreendimento.';
comment on column public.real_estate_units.cv_crm_last_seen_at is
  'Ultima vez que o CV CRM retornou esta unidade na sincronizacao.';
comment on column public.real_estate_units.cv_crm_stale_since is
  'Desde quando o CV CRM deixou de retornar esta unidade na sincronizacao.';

notify pgrst, 'reload schema';
