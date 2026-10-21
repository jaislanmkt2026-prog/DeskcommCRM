-- STATUS: DEFERRED
-- MOTIVO: CV CRM / Engenharq postponed by owner
-- DO NOT APPLY
--
-- 0386 — adicionar external_id para rastreabilidade reversa CV→Deskcomm
--
-- Adiciona coluna external_id text nullable em real_estate_developments e real_estate_units
-- para mapear IDs externos do CV CRM (ex: empreendimento ID 14, unidade_ref).
-- Idempotente, portável em psql puro.

-- ─── 1. real_estate_developments.external_id ────────────────────────────────
alter table public.real_estate_developments
  add column if not exists external_id text;

comment on column public.real_estate_developments.external_id is
  'ID externo no CV CRM para rastreabilidade reversa (ex: empreendimento ID 14).';

create index if not exists idx_developments_external_id
  on public.real_estate_developments (external_id)
  where external_id is not null;

-- ─── 2. real_estate_units.external_id ───────────────────────────────────────
alter table public.real_estate_units
  add column if not exists external_id text;

comment on column public.real_estate_units.external_id is
  'ID externo no CV CRM para rastreabilidade reversa (ex: unidade_ref da tabela de preço).';

create index if not exists idx_units_external_id
  on public.real_estate_units (external_id)
  where external_id is not null;