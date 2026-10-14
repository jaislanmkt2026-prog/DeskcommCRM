-- 0528 — staging e trilha de ingestao do CV CRM
--
-- A versao antiga da Missao 8 nasceu num sandbox sem FK de organization e com
-- SELECT authenticated USING (true). Este forward-fix preserva a semantica da
-- ingestao e fecha a fronteira multi-tenant no schema operacional atual.
-- Staging/log sao escritos somente pelo servidor; usuarios autenticados leem
-- apenas as linhas da propria organizacao.

create table if not exists public.cv_crm_staging (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  entity_type text not null,
  external_id text not null,
  raw_payload jsonb not null,
  validation_status text not null default 'pending',
  validation_errors jsonb not null default '[]'::jsonb,
  target_internal_id uuid,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.cv_crm_ingestion_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id uuid not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  source text not null default 'cv_crm',
  total_records integer not null default 0,
  valid_records integer not null default 0,
  invalid_records integer not null default 0,
  skipped_records integer not null default 0,
  processed_records integer not null default 0,
  status text not null default 'running',
  error_message text,
  metadata jsonb not null default '{}'::jsonb
);

-- Cura o formato inseguro que existiu apenas na sandbox antiga. Linha sem
-- tenant valido em staging/log tecnico nao pode ser atribuida por adivinhacao.
delete from public.cv_crm_staging s
where s.organization_id is null
   or not exists (
     select 1 from public.organizations o where o.id = s.organization_id
   );

delete from public.cv_crm_ingestion_logs l
where l.organization_id is null
   or not exists (
     select 1 from public.organizations o where o.id = l.organization_id
   );

delete from public.cv_crm_staging
where external_id is null or btrim(external_id) = '';
update public.cv_crm_staging
set validation_errors = '[]'::jsonb
where validation_errors is null;

update public.cv_crm_ingestion_logs
set metadata = '{}'::jsonb
where metadata is null;

alter table public.cv_crm_staging
  alter column organization_id set not null,
  alter column external_id set not null,
  alter column validation_errors set default '[]'::jsonb,
  alter column validation_errors set not null;

alter table public.cv_crm_ingestion_logs
  alter column organization_id set not null,
  alter column metadata set default '{}'::jsonb,
  alter column metadata set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cv_crm_staging'::regclass
      and conname = 'cv_crm_staging_organization_id_fkey'
  ) then
    alter table public.cv_crm_staging
      add constraint cv_crm_staging_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;
end
$$;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.cv_crm_ingestion_logs'::regclass
      and conname = 'cv_crm_ingestion_logs_organization_id_fkey'
  ) then
    alter table public.cv_crm_ingestion_logs
      add constraint cv_crm_ingestion_logs_organization_id_fkey
      foreign key (organization_id) references public.organizations(id) on delete cascade;
  end if;
end
$$;

alter table public.cv_crm_staging
  drop constraint if exists cv_crm_staging_entity_type_check;
alter table public.cv_crm_staging
  add constraint cv_crm_staging_entity_type_check
  check (entity_type in ('development', 'unit', 'price_list', 'price_list_item'));

alter table public.cv_crm_staging
  drop constraint if exists cv_crm_staging_validation_status_check;
alter table public.cv_crm_staging
  add constraint cv_crm_staging_validation_status_check
  check (validation_status in ('pending', 'valid', 'invalid', 'processed', 'skipped'));

alter table public.cv_crm_staging
  drop constraint if exists cv_crm_staging_external_id_not_blank;
alter table public.cv_crm_staging
  add constraint cv_crm_staging_external_id_not_blank
  check (length(btrim(external_id)) > 0);

alter table public.cv_crm_ingestion_logs
  drop constraint if exists cv_crm_ingestion_logs_status_check;
alter table public.cv_crm_ingestion_logs
  add constraint cv_crm_ingestion_logs_status_check
  check (status in ('running', 'completed', 'failed', 'partial'));

-- A sandbox antiga usava unicidade global por batch; a chave correta inclui
-- organization_id, pois o batch pertence ao tenant.
drop index if exists public.uq_cv_crm_staging_batch_entity_external;
alter table public.cv_crm_ingestion_logs
  drop constraint if exists cv_crm_ingestion_logs_batch_id_key;

create unique index if not exists uq_cv_crm_staging_org_batch_entity_external
  on public.cv_crm_staging (organization_id, batch_id, entity_type, external_id);

create unique index if not exists uq_cv_crm_ingestion_logs_org_batch
  on public.cv_crm_ingestion_logs (organization_id, batch_id);

create index if not exists idx_cv_crm_staging_org_batch
  on public.cv_crm_staging (organization_id, batch_id);
create index if not exists idx_cv_crm_staging_org_status
  on public.cv_crm_staging (organization_id, validation_status);
create index if not exists idx_cv_crm_ingestion_logs_org_started
  on public.cv_crm_ingestion_logs (organization_id, started_at desc);
alter table public.cv_crm_staging enable row level security;
alter table public.cv_crm_ingestion_logs enable row level security;

revoke all on table public.cv_crm_staging from public, anon, authenticated;
revoke all on table public.cv_crm_ingestion_logs from public, anon, authenticated;
grant select on table public.cv_crm_staging to authenticated;
grant select on table public.cv_crm_ingestion_logs to authenticated;
grant select, insert, update, delete on table public.cv_crm_staging to service_role;
grant select, insert, update, delete on table public.cv_crm_ingestion_logs to service_role;

drop policy if exists "cv_crm_staging_tenant_select" on public.cv_crm_staging;
drop policy if exists "cv_crm_ingestion_logs_tenant_select" on public.cv_crm_ingestion_logs;

drop policy if exists "cv_crm_staging_authenticated_select" on public.cv_crm_staging;
create policy "cv_crm_staging_authenticated_select"
  on public.cv_crm_staging
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

drop policy if exists "cv_crm_ingestion_logs_authenticated_select" on public.cv_crm_ingestion_logs;
create policy "cv_crm_ingestion_logs_authenticated_select"
  on public.cv_crm_ingestion_logs
  for select to authenticated
  using (organization_id in (select public.fn_user_org_ids()));

comment on table public.cv_crm_staging is
  'Staging tecnico tenant-scoped da sincronizacao oficial com CV CRM.';
comment on table public.cv_crm_ingestion_logs is
  'Trilha tecnica tenant-scoped dos batches de ingestao do CV CRM.';
create or replace function public.fn_validate_cv_crm_record(
  p_entity_type text,
  p_raw_payload jsonb
) returns jsonb
language plpgsql
stable
as $$
declare
  v_errors text[] := array[]::text[];
  v_valor_cents_text text;
  v_vigencia_inicio text;
  v_vigencia_fim text;
begin
  if p_raw_payload is null or jsonb_typeof(p_raw_payload) <> 'object' then
    return jsonb_build_object(
      'valid', false,
      'errors', to_jsonb(array['payload deve ser um objeto JSON'])
    );
  end if;

  case p_entity_type
    when 'development' then
      if nullif(btrim(p_raw_payload->>'nome'), '') is null then
        v_errors := array_append(v_errors, 'nome e obrigatorio');
      end if;
      if nullif(btrim(p_raw_payload->>'constructor_id'), '') is null then
        v_errors := array_append(v_errors, 'constructor_id e obrigatorio');
      end if;
    when 'unit' then
      if nullif(btrim(p_raw_payload->>'numero'), '') is null then
        v_errors := array_append(v_errors, 'numero e obrigatorio');
      end if;
      if nullif(btrim(p_raw_payload->>'development_id'), '') is null then
        v_errors := array_append(v_errors, 'development_id e obrigatorio');
      end if;

    when 'price_list' then
      if nullif(btrim(p_raw_payload->>'nome'), '') is null then
        v_errors := array_append(v_errors, 'nome e obrigatorio');
      end if;
      if nullif(btrim(p_raw_payload->>'development_id'), '') is null then
        v_errors := array_append(v_errors, 'development_id e obrigatorio');
      end if;
      v_vigencia_inicio := p_raw_payload->>'vigencia_inicio';
      v_vigencia_fim := p_raw_payload->>'vigencia_fim';
      if v_vigencia_inicio is null then
        v_errors := array_append(v_errors, 'vigencia_inicio e obrigatoria');
      elsif v_vigencia_inicio !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        v_errors := array_append(v_errors, 'vigencia_inicio deve usar YYYY-MM-DD');
      end if;
      if v_vigencia_fim is not null then
        if v_vigencia_fim !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          v_errors := array_append(v_errors, 'vigencia_fim deve usar YYYY-MM-DD');
        elsif v_vigencia_inicio ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and v_vigencia_fim < v_vigencia_inicio then
          v_errors := array_append(v_errors, 'vigencia_fim deve ser >= vigencia_inicio');
        end if;
      end if;

    when 'price_list_item' then
      v_valor_cents_text := p_raw_payload->>'valor_cents';
      if v_valor_cents_text is null then
        v_errors := array_append(v_errors, 'valor_cents e obrigatorio');
      elsif v_valor_cents_text !~ '^[0-9]+$' then
        v_errors := array_append(v_errors, 'valor_cents deve ser inteiro positivo');
      elsif v_valor_cents_text::numeric <= 0 then
        v_errors := array_append(v_errors, 'valor_cents deve ser > 0');
      end if;
      if nullif(btrim(p_raw_payload->>'unit_id'), '') is null then
        v_errors := array_append(v_errors, 'unit_id e obrigatorio');
      end if;

    else
      v_errors := array_append(v_errors, 'entity_type desconhecido: ' || coalesce(p_entity_type, 'null'));
  end case;

  return jsonb_build_object(
    'valid', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors)
  );
end;
$$;
revoke execute on function public.fn_validate_cv_crm_record(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_validate_cv_crm_record(text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
