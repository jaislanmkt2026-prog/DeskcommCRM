-- 0529 — funcao de aplicacao dos registros validados do CV CRM
--
-- Aplica os registros em staging (status = 'valid') nas tabelas operacionais:
-- constructors, real_estate_developments, real_estate_units.
-- As tabelas de destino NAO tem external_id; usamos matching por nome/numero.

create or replace function public.fn_apply_cv_crm_valid_records(
  p_organization_id uuid,
  p_batch_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_constructor_id uuid;
  v_development_id uuid;
  v_count integer := 0;
begin
  -- developments: cria constructor + development
  for v_row in
    select s.*
    from public.cv_crm_staging s
    where s.organization_id = p_organization_id
      and s.batch_id = p_batch_id
      and s.entity_type = 'development'
      and s.validation_status = 'valid'
  loop
    -- upsert constructor pelo nome
    insert into public.constructors (
      organization_id,
      nome,
      tipo_integracao,
      ativo,
      created_at,
      updated_at
    ) values (
      v_row.organization_id,
      (v_row.raw_payload->>'constructor_nome')::text,
      'api',
      true,
      now(),
      now()
    )
    on conflict (organization_id, nome)
    do update set
      updated_at = now()
    returning id into v_constructor_id;

    if v_constructor_id is null then
      select id into v_constructor_id
      from public.constructors
      where organization_id = v_row.organization_id
        and nome = (v_row.raw_payload->>'constructor_nome')::text
      limit 1;
    end if;

    -- upsert development
    insert into public.real_estate_developments (
      organization_id,
      constructor_id,
      nome,
      localizacao,
      bairro,
      cidade,
      status,
      created_at,
      updated_at
    ) values (
      v_row.organization_id,
      v_constructor_id,
      (v_row.raw_payload->>'nome')::text,
      (v_row.raw_payload->>'localizacao')::text,
      (v_row.raw_payload->>'bairro')::text,
      (v_row.raw_payload->>'cidade')::text,
      coalesce((v_row.raw_payload->>'status')::text, 'em_andamento'),
      now(),
      now()
    )
    on conflict (organization_id, constructor_id, nome)
    do update set
      localizacao = excluded.localizacao,
      bairro = excluded.bairro,
      cidade = excluded.cidade,
      status = excluded.status,
      updated_at = now()
    returning id into v_development_id;

    if v_development_id is null then
      select id into v_development_id
      from public.real_estate_developments
      where organization_id = v_row.organization_id
        and constructor_id = v_constructor_id
        and nome = (v_row.raw_payload->>'nome')::text
      limit 1;
    end if;

    v_count := v_count + 1;
  end loop;

  -- units
  for v_row in
    select s.*
    from public.cv_crm_staging s
    where s.organization_id = p_organization_id
      and s.batch_id = p_batch_id
      and s.entity_type = 'unit'
      and s.validation_status = 'valid'
  loop
    -- busca development pelo external_id no staging
    select d.id into v_development_id
    from public.cv_crm_staging s2
    join public.real_estate_developments d
      on d.organization_id = s2.organization_id
      and d.nome = (s2.raw_payload->>'nome')::text
    where s2.organization_id = p_organization_id
      and s2.batch_id = p_batch_id
      and s2.external_id = (v_row.raw_payload->>'development_external_id')::text
      and s2.entity_type = 'development'
    limit 1;

    if v_development_id is null then
      raise notice '[fn_apply] unit % sem development encontrado, pulando', v_row.external_id;
      continue;
    end if;

    insert into public.real_estate_units (
      organization_id,
      development_id,
      bloco,
      numero,
      andar,
      metragem,
      quartos,
      suites,
      vagas,
      valor_cents,
      status,
      created_at,
      updated_at
    ) values (
      v_row.organization_id,
      v_development_id,
      (v_row.raw_payload->>'bloco')::text,
      (v_row.raw_payload->>'numero')::text,
      nullif((v_row.raw_payload->>'andar')::text, '')::integer,
      nullif((v_row.raw_payload->>'metragem')::text, '')::numeric,
      nullif((v_row.raw_payload->>'quartos')::text, '')::integer,
      nullif((v_row.raw_payload->>'suites')::text, '')::integer,
      nullif((v_row.raw_payload->>'vagas')::text, '')::integer,
      (v_row.raw_payload->>'valor_cents')::bigint,
      coalesce((v_row.raw_payload->>'status')::text, 'disponivel'),
      now(),
      now()
    )
    on conflict (development_id, bloco, numero)
    do update set
      andar = excluded.andar,
      metragem = excluded.metragem,
      quartos = excluded.quartos,
      suites = excluded.suites,
      vagas = excluded.vagas,
      valor_cents = excluded.valor_cents,
      status = excluded.status,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  raise notice '[fn_apply_cv_crm_valid_records] applied % records for org %, batch %',
    v_count, p_organization_id, p_batch_id;
end;
$$;

revoke execute on function public.fn_apply_cv_crm_valid_records(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_apply_cv_crm_valid_records(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';