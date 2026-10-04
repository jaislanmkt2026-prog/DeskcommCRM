-- 0529 — aplicacao atomica do snapshot oficial CV CRM (v3)
--
-- Fecha o contrato entre adapter -> validator -> staging -> aplicacao.
-- A 0528 validava IDs internos que o adapter oficial nunca produz; esta migration
-- faz o forward-fix para referencias EXTERNAS e endurece disponibilidade/preco.
--
-- Regra operacional: qualquer dependencia ausente em registro classificado como
-- valido aborta o batch inteiro. Nenhum registro "valido" e silenciosamente
-- pulado. A propria funcao marca o staging como processed na mesma transacao.

create or replace function public.fn_validate_cv_crm_record(
  p_entity_type text,
  p_raw_payload jsonb
) returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_errors text[] := array[]::text[];
  v_text text;
  v_status text;
  v_valor numeric;
  v_sinal numeric;
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
      if nullif(btrim(p_raw_payload->>'constructor_nome'), '') is null then
        v_errors := array_append(v_errors, 'constructor_nome e obrigatorio');
      end if;
      v_status := nullif(btrim(p_raw_payload->>'status'), '');
      if v_status is not null and v_status not in ('planejamento', 'em_andamento', 'concluido', 'pausado') then
        v_errors := array_append(v_errors, 'status de empreendimento invalido');
      end if;

    when 'unit' then
      if nullif(btrim(p_raw_payload->>'numero'), '') is null then
        v_errors := array_append(v_errors, 'numero e obrigatorio');
      end if;
      if nullif(btrim(p_raw_payload->>'development_external_id'), '') is null then
        v_errors := array_append(v_errors, 'development_external_id e obrigatorio');
      end if;
      v_status := nullif(btrim(p_raw_payload->>'status'), '');
      if v_status is null then
        v_errors := array_append(v_errors, 'status/disponibilidade e obrigatorio');
      elsif v_status not in ('disponivel', 'reservado', 'vendido', 'bloqueado') then
        v_errors := array_append(v_errors, 'status/disponibilidade invalido');
      end if;

      v_text := nullif(btrim(p_raw_payload->>'valor_cents'), '');
      if v_text is not null then
        if v_text !~ '^[0-9]+$' then
          v_errors := array_append(v_errors, 'valor_cents deve ser inteiro positivo quando informado');
        elsif v_text::numeric <= 0 then
          v_errors := array_append(v_errors, 'valor_cents deve ser > 0 quando informado');
        end if;
      end if;

      foreach v_text in array array[
        nullif(btrim(p_raw_payload->>'andar'), ''),
        nullif(btrim(p_raw_payload->>'quartos'), ''),
        nullif(btrim(p_raw_payload->>'suites'), ''),
        nullif(btrim(p_raw_payload->>'vagas'), '')
      ]
      loop
        if v_text is not null and v_text !~ '^-?[0-9]+$' then
          v_errors := array_append(v_errors, 'campos inteiros da unidade devem ser numericos');
          exit;
        end if;
      end loop;

      v_text := nullif(btrim(p_raw_payload->>'metragem'), '');
      if v_text is not null and v_text !~ '^[0-9]+([.][0-9]+)?$' then
        v_errors := array_append(v_errors, 'metragem deve ser numerica');
      end if;

    when 'price_list' then
      if nullif(btrim(p_raw_payload->>'nome'), '') is null then
        v_errors := array_append(v_errors, 'nome e obrigatorio');
      end if;
      if nullif(btrim(p_raw_payload->>'development_external_id'), '') is null then
        v_errors := array_append(v_errors, 'development_external_id e obrigatorio');
      end if;

      v_text := nullif(btrim(p_raw_payload->>'versao'), '');
      if v_text is not null and v_text !~ '^[0-9]+$' then
        v_errors := array_append(v_errors, 'versao deve ser inteiro positivo');
      elsif v_text is not null and v_text::numeric <= 0 then
        v_errors := array_append(v_errors, 'versao deve ser > 0');
      end if;

      v_vigencia_inicio := nullif(btrim(p_raw_payload->>'vigencia_inicio'), '');
      v_vigencia_fim := nullif(btrim(p_raw_payload->>'vigencia_fim'), '');
      if v_vigencia_inicio is null then
        v_errors := array_append(v_errors, 'vigencia_inicio e obrigatoria');
      elsif v_vigencia_inicio !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
         or to_char(to_date(v_vigencia_inicio, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_vigencia_inicio then
        v_errors := array_append(v_errors, 'vigencia_inicio deve ser data YYYY-MM-DD valida');
      end if;

      if v_vigencia_fim is not null then
        if v_vigencia_fim !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           or to_char(to_date(v_vigencia_fim, 'YYYY-MM-DD'), 'YYYY-MM-DD') <> v_vigencia_fim then
          v_errors := array_append(v_errors, 'vigencia_fim deve ser data YYYY-MM-DD valida');
        elsif v_vigencia_inicio is not null
          and v_vigencia_inicio ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and to_char(to_date(v_vigencia_inicio, 'YYYY-MM-DD'), 'YYYY-MM-DD') = v_vigencia_inicio
          and v_vigencia_fim::date < v_vigencia_inicio::date then
          v_errors := array_append(v_errors, 'vigencia_fim deve ser >= vigencia_inicio');
        end if;
      end if;

      v_status := nullif(btrim(p_raw_payload->>'status'), '');
      if v_status is not null and v_status not in ('ativa', 'inativa', 'rascunho') then
        v_errors := array_append(v_errors, 'status de tabela de preco invalido');
      end if;

    when 'price_list_item' then
      if nullif(btrim(p_raw_payload->>'price_list_external_id'), '') is null then
        v_errors := array_append(v_errors, 'price_list_external_id e obrigatorio');
      end if;
      if nullif(btrim(p_raw_payload->>'unit_external_id'), '') is null then
        v_errors := array_append(v_errors, 'unit_external_id e obrigatorio');
      end if;

      v_text := nullif(btrim(p_raw_payload->>'valor_cents'), '');
      if v_text is null then
        v_errors := array_append(v_errors, 'valor_cents e obrigatorio');
      elsif v_text !~ '^[0-9]+$' then
        v_errors := array_append(v_errors, 'valor_cents deve ser inteiro positivo');
      elsif v_text::numeric <= 0 then
        v_errors := array_append(v_errors, 'valor_cents deve ser > 0');
      else
        v_valor := v_text::numeric;
      end if;

      v_text := nullif(btrim(p_raw_payload->>'sinal_cents'), '');
      if v_text is not null then
        if v_text !~ '^[0-9]+$' then
          v_errors := array_append(v_errors, 'sinal_cents deve ser inteiro nao negativo');
        else
          v_sinal := v_text::numeric;
          if v_valor is not null and v_sinal > v_valor then
            v_errors := array_append(v_errors, 'sinal_cents nao pode superar valor_cents');
          end if;
        end if;
      end if;

      v_status := nullif(btrim(p_raw_payload->>'status'), '');
      if v_status is null then
        v_errors := array_append(v_errors, 'status/disponibilidade e obrigatorio');
      elsif v_status not in ('disponivel', 'reservado', 'vendido', 'bloqueado') then
        v_errors := array_append(v_errors, 'status/disponibilidade invalido');
      end if;

    else
      v_errors := array_append(v_errors, 'entity_type desconhecido: ' || coalesce(p_entity_type, 'null'));
  end case;

  return jsonb_build_object(
    'valid', cardinality(v_errors) = 0,
    'errors', to_jsonb(v_errors)
  );
exception
  when others then
    return jsonb_build_object(
      'valid', false,
      'errors', jsonb_build_array('payload invalido: ' || sqlerrm)
    );
end;
$$;

revoke execute on function public.fn_validate_cv_crm_record(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.fn_validate_cv_crm_record(text, jsonb)
  to service_role;

-- Lock operacional por tenant. Se um processo morrer, o runtime encerra logs
-- "running" com mais de 1h antes de tentar adquirir o lock novamente.
-- Cura eventual duplicidade preexistente antes de criar o indice parcial.
with ranked as (
  select id,
         row_number() over (
           partition by organization_id
           order by started_at desc, id desc
         ) as rn
    from public.cv_crm_ingestion_logs
   where status = 'running'
)
update public.cv_crm_ingestion_logs l
   set status = 'failed',
       finished_at = coalesce(l.finished_at, now()),
       error_message = coalesce(l.error_message, 'encerrado pela 0529: lock running duplicado preexistente')
  from ranked r
 where l.id = r.id
   and r.rn > 1;

create unique index if not exists uq_cv_crm_one_running_per_org
  on public.cv_crm_ingestion_logs (organization_id)
  where status = 'running';

-- O rascunho anterior da 0529 retornava void. DROP permite forward-fix seguro
-- em bancos de teste onde aquele rascunho chegou a ser materializado.
drop function if exists public.fn_apply_cv_crm_valid_records(uuid, uuid);

create function public.fn_apply_cv_crm_valid_records(
  p_organization_id uuid,
  p_batch_id uuid
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_constructor_id uuid;
  v_development_id uuid;
  v_unit_id uuid;
  v_price_list_id uuid;
  v_existing_unit_id uuid;
  v_old_valor_cents bigint;
  v_old_status text;
  v_new_valor_cents bigint;
  v_new_status text;
  v_count integer := 0;
  v_marked integer := 0;
begin
  -- Serializa aplicacoes do MESMO tenant, inclusive batches diferentes.
  -- O indice de log impede concorrencia no pipeline; este lock protege tambem
  -- chamadas diretas da RPC.
  perform pg_advisory_xact_lock(
    hashtext('cv_crm_apply'),
    hashtext(p_organization_id::text)
  );

  -- DEVELOPMENTS
  for v_row in
    select s.*
      from public.cv_crm_staging s
     where s.organization_id = p_organization_id
       and s.batch_id = p_batch_id
       and s.entity_type = 'development'
       and s.validation_status = 'valid'
     order by s.id
  loop
    v_constructor_id := null;

    -- constructors nao possui UNIQUE(org,nome). O advisory lock do batch +
    -- lookup explicito evita depender de um ON CONFLICT inexistente.
    select c.id
      into v_constructor_id
      from public.constructors c
     where c.organization_id = p_organization_id
       and c.nome = (v_row.raw_payload->>'constructor_nome')::text
     order by c.created_at, c.id
     limit 1
     for update;

    if v_constructor_id is null then
      insert into public.constructors (
        organization_id, nome, tipo_integracao, ativo, created_at, updated_at
      ) values (
        p_organization_id,
        (v_row.raw_payload->>'constructor_nome')::text,
        'api', true, now(), now()
      )
      returning id into v_constructor_id;
    end if;

    insert into public.real_estate_developments (
      organization_id, constructor_id, nome, localizacao, bairro, cidade,
      status, external_id, cv_crm_last_seen_at, created_at, updated_at
    ) values (
      p_organization_id,
      v_constructor_id,
      (v_row.raw_payload->>'nome')::text,
      (v_row.raw_payload->>'localizacao')::text,
      (v_row.raw_payload->>'bairro')::text,
      (v_row.raw_payload->>'cidade')::text,
      coalesce(nullif((v_row.raw_payload->>'status')::text, ''), 'em_andamento'),
      v_row.external_id,
      now(), now(), now()
    )
    on conflict (organization_id, external_id)
    where external_id is not null
    do update set
      constructor_id = excluded.constructor_id,
      nome = excluded.nome,
      localizacao = excluded.localizacao,
      bairro = excluded.bairro,
      cidade = excluded.cidade,
      status = excluded.status,
      cv_crm_last_seen_at = now(),
      cv_crm_stale_since = null,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  -- UNITS
  for v_row in
    select s.*
      from public.cv_crm_staging s
     where s.organization_id = p_organization_id
       and s.batch_id = p_batch_id
       and s.entity_type = 'unit'
       and s.validation_status = 'valid'
     order by s.id
  loop
    v_development_id := null;
    select d.id
      into v_development_id
      from public.real_estate_developments d
     where d.organization_id = p_organization_id
       and d.external_id = (v_row.raw_payload->>'development_external_id')::text
     limit 1;

    if v_development_id is null then
      raise exception 'CV_CRM_DEPENDENCY_MISSING: unit % sem development_external_id %',
        v_row.external_id, v_row.raw_payload->>'development_external_id'
        using errcode = '23503';
    end if;

    v_existing_unit_id := null;
    v_old_valor_cents := null;
    v_old_status := null;
    select u.id, u.valor_cents, u.status
      into v_existing_unit_id, v_old_valor_cents, v_old_status
      from public.real_estate_units u
     where u.organization_id = p_organization_id
       and u.external_id = v_row.external_id
     limit 1
     for update;

    v_new_valor_cents := nullif((v_row.raw_payload->>'valor_cents')::text, '')::bigint;
    v_new_status := (v_row.raw_payload->>'status')::text;

    insert into public.real_estate_units (
      organization_id, development_id, bloco, numero, andar, metragem,
      quartos, suites, vagas, valor_cents, condicoes, status,
      external_id, cv_crm_last_seen_at, created_at, updated_at
    ) values (
      p_organization_id,
      v_development_id,
      (v_row.raw_payload->>'bloco')::text,
      (v_row.raw_payload->>'numero')::text,
      nullif((v_row.raw_payload->>'andar')::text, '')::integer,
      nullif((v_row.raw_payload->>'metragem')::text, '')::numeric,
      nullif((v_row.raw_payload->>'quartos')::text, '')::integer,
      nullif((v_row.raw_payload->>'suites')::text, '')::integer,
      nullif((v_row.raw_payload->>'vagas')::text, '')::integer,
      v_new_valor_cents,
      (v_row.raw_payload->>'condicoes')::text,
      v_new_status,
      v_row.external_id,
      now(), now(), now()
    )
    on conflict (organization_id, external_id)
    where external_id is not null
    do update set
      development_id = excluded.development_id,
      bloco = excluded.bloco,
      numero = excluded.numero,
      andar = excluded.andar,
      metragem = excluded.metragem,
      quartos = excluded.quartos,
      suites = excluded.suites,
      vagas = excluded.vagas,
      valor_cents = excluded.valor_cents,
      condicoes = excluded.condicoes,
      status = excluded.status,
      cv_crm_last_seen_at = now(),
      cv_crm_stale_since = null,
      updated_at = now()
    returning id into v_unit_id;

    if v_existing_unit_id is not null then
      if v_old_valor_cents is distinct from v_new_valor_cents then
        insert into public.real_estate_history (
          organization_id, unit_id, campo, valor_anterior, valor_novo, fonte
        ) values (
          p_organization_id, v_unit_id, 'valor_cents',
          v_old_valor_cents::text, v_new_valor_cents::text, 'cv_crm'
        );
      end if;
      if v_old_status is distinct from v_new_status then
        insert into public.real_estate_history (
          organization_id, unit_id, campo, valor_anterior, valor_novo, fonte
        ) values (
          p_organization_id, v_unit_id, 'status',
          v_old_status, v_new_status, 'cv_crm'
        );
      end if;
    end if;

    v_count := v_count + 1;
  end loop;

  -- PRICE LISTS
  for v_row in
    select s.*
      from public.cv_crm_staging s
     where s.organization_id = p_organization_id
       and s.batch_id = p_batch_id
       and s.entity_type = 'price_list'
       and s.validation_status = 'valid'
     order by s.id
  loop
    v_development_id := null;
    v_constructor_id := null;
    select d.id, d.constructor_id
      into v_development_id, v_constructor_id
      from public.real_estate_developments d
     where d.organization_id = p_organization_id
       and d.external_id = (v_row.raw_payload->>'development_external_id')::text
     limit 1;

    if v_development_id is null then
      raise exception 'CV_CRM_DEPENDENCY_MISSING: price_list % sem development_external_id %',
        v_row.external_id, v_row.raw_payload->>'development_external_id'
        using errcode = '23503';
    end if;

    insert into public.real_estate_price_lists (
      organization_id, constructor_id, development_id, nome, etapa, versao,
      vigencia_inicio, vigencia_fim, origem_ref, status, fonte,
      external_id, created_at, updated_at
    ) values (
      p_organization_id,
      v_constructor_id,
      v_development_id,
      (v_row.raw_payload->>'nome')::text,
      (v_row.raw_payload->>'etapa')::text,
      coalesce(nullif((v_row.raw_payload->>'versao')::text, '')::integer, 1),
      (v_row.raw_payload->>'vigencia_inicio')::date,
      nullif((v_row.raw_payload->>'vigencia_fim')::text, '')::date,
      (v_row.raw_payload->>'origem_ref')::text,
      coalesce(nullif((v_row.raw_payload->>'status')::text, ''), 'ativa'),
      'cv_crm',
      v_row.external_id,
      now(), now()
    )
    on conflict (organization_id, external_id)
    where external_id is not null
    do update set
      constructor_id = excluded.constructor_id,
      development_id = excluded.development_id,
      nome = excluded.nome,
      etapa = excluded.etapa,
      versao = excluded.versao,
      vigencia_inicio = excluded.vigencia_inicio,
      vigencia_fim = excluded.vigencia_fim,
      origem_ref = excluded.origem_ref,
      status = excluded.status,
      fonte = 'cv_crm',
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  -- PRICE LIST ITEMS
  for v_row in
    select s.*
      from public.cv_crm_staging s
     where s.organization_id = p_organization_id
       and s.batch_id = p_batch_id
       and s.entity_type = 'price_list_item'
       and s.validation_status = 'valid'
     order by s.id
  loop
    v_price_list_id := null;
    select pl.id
      into v_price_list_id
      from public.real_estate_price_lists pl
     where pl.organization_id = p_organization_id
       and pl.external_id = (v_row.raw_payload->>'price_list_external_id')::text
     limit 1;

    if v_price_list_id is null then
      raise exception 'CV_CRM_DEPENDENCY_MISSING: price_list_item % sem price_list_external_id %',
        v_row.external_id, v_row.raw_payload->>'price_list_external_id'
        using errcode = '23503';
    end if;

    v_unit_id := null;
    select u.id
      into v_unit_id
      from public.real_estate_units u
     where u.organization_id = p_organization_id
       and u.external_id = (v_row.raw_payload->>'unit_external_id')::text
     limit 1;

    if v_unit_id is null then
      raise exception 'CV_CRM_DEPENDENCY_MISSING: price_list_item % sem unit_external_id %',
        v_row.external_id, v_row.raw_payload->>'unit_external_id'
        using errcode = '23503';
    end if;

    insert into public.real_estate_price_list_items (
      organization_id, price_list_id, unit_id, valor_cents, sinal_cents,
      parcelas, financiamento, condicoes_chaves, status, quadra,
      unidade_ref, observacoes, external_id, created_at, updated_at
    ) values (
      p_organization_id,
      v_price_list_id,
      v_unit_id,
      (v_row.raw_payload->>'valor_cents')::bigint,
      nullif((v_row.raw_payload->>'sinal_cents')::text, '')::bigint,
      v_row.raw_payload->'parcelas',
      (v_row.raw_payload->>'financiamento')::text,
      (v_row.raw_payload->>'condicoes_chaves')::text,
      (v_row.raw_payload->>'status')::text,
      (v_row.raw_payload->>'quadra')::text,
      (v_row.raw_payload->>'unidade_ref')::text,
      (v_row.raw_payload->>'observacoes')::text,
      v_row.external_id,
      now(), now()
    )
    on conflict (organization_id, external_id)
    where external_id is not null
    do update set
      price_list_id = excluded.price_list_id,
      unit_id = excluded.unit_id,
      valor_cents = excluded.valor_cents,
      sinal_cents = excluded.sinal_cents,
      parcelas = excluded.parcelas,
      financiamento = excluded.financiamento,
      condicoes_chaves = excluded.condicoes_chaves,
      status = excluded.status,
      quadra = excluded.quadra,
      unidade_ref = excluded.unidade_ref,
      observacoes = excluded.observacoes,
      updated_at = now();

    v_count := v_count + 1;
  end loop;

  update public.cv_crm_staging
     set validation_status = 'processed',
         processed_at = now()
   where organization_id = p_organization_id
     and batch_id = p_batch_id
     and validation_status = 'valid';

  get diagnostics v_marked = row_count;
  if v_marked <> v_count then
    raise exception 'CV_CRM_APPLY_COUNT_MISMATCH: aplicados %, staging marcado %',
      v_count, v_marked;
  end if;

  return v_count;
end;
$$;

revoke execute on function public.fn_apply_cv_crm_valid_records(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.fn_apply_cv_crm_valid_records(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';
