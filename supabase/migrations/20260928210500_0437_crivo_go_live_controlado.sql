-- 0437 — Crivo: go-live controlado sem executor paralelo.

alter table public.system_upstream_state
  add column if not exists crivo_environment text,
  add column if not exists kill_switch boolean not null default false,
  add column if not exists change_fingerprint text not null default '',
  add column if not exists approval_fingerprint text,
  add column if not exists approval_approved_by uuid,
  add column if not exists approval_approved_at timestamptz,
  add column if not exists approval_consumed_at timestamptz;

alter table public.system_upstream_state
  drop constraint if exists system_upstream_state_crivo_environment;
alter table public.system_upstream_state
  add constraint system_upstream_state_crivo_environment
  check (crivo_environment is null or crivo_environment in ('local','staging','production'));

alter table public.system_upstream_state
  drop constraint if exists system_upstream_state_change_fingerprint;
alter table public.system_upstream_state
  add constraint system_upstream_state_change_fingerprint
  check (change_fingerprint = '' or change_fingerprint ~ '^[0-9a-f]{64}$');

alter table public.system_upstream_state
  drop constraint if exists system_upstream_state_approval_coerente;
alter table public.system_upstream_state
  add constraint system_upstream_state_approval_coerente check (
    (approval_fingerprint is null and approval_approved_by is null and approval_approved_at is null and approval_consumed_at is null)
    or (
      approval_fingerprint ~ '^[0-9a-f]{64}$'
      and approval_approved_by is not null
      and approval_approved_at is not null
    )
  );

alter table public.system_update_runs
  add column if not exists crivo_environment text,
  add column if not exists change_fingerprint text,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz;

alter table public.system_update_runs
  drop constraint if exists system_update_runs_crivo_environment;
alter table public.system_update_runs
  add constraint system_update_runs_crivo_environment
  check (crivo_environment is null or crivo_environment in ('local','staging','production'));

create or replace function public.fn_crivo_dispatch_update(
  p_from_version text,
  p_to_version text,
  p_requested_by uuid,
  p_fingerprint text,
  p_environment text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $fn$
declare
  v_state public.system_upstream_state%rowtype;
  v_run_id uuid;
begin
  if p_environment not in ('local','staging','production') then
    raise exception using errcode = 'P0001', message = 'crivo_environment_invalid';
  end if;

  select * into v_state
    from public.system_upstream_state
   where id = 1
   for update;

  if not found then
    raise exception using errcode = 'P0001', message = 'crivo_state_missing';
  end if;
  if v_state.kill_switch then
    raise exception using errcode = 'P0001', message = 'crivo_killed';
  end if;
  if v_state.crivo_environment is distinct from p_environment then
    raise exception using errcode = 'P0001', message = 'crivo_environment_mismatch';
  end if;
  if p_fingerprint is null or p_fingerprint = '' or v_state.change_fingerprint <> p_fingerprint then
    raise exception using errcode = 'P0001', message = 'crivo_change_mismatch';
  end if;
  if v_state.analysis_status <> 'completed' then
    raise exception using errcode = 'P0001', message = 'crivo_analysis_incomplete';
  end if;

  if p_environment = 'production' and not (
    v_state.approval_fingerprint = p_fingerprint
    and v_state.approval_approved_by is not null
    and v_state.approval_approved_at is not null
    and v_state.approval_consumed_at is null
  ) then
    raise exception using errcode = 'P0001', message = 'crivo_approval_required';
  end if;

  insert into public.system_update_runs (
    from_version, to_version, status, requested_by, crivo_environment, change_fingerprint, approved_by, approved_at
  ) values (
    p_from_version, p_to_version, 'dispatched', p_requested_by, p_environment, p_fingerprint,
    case when p_environment = 'production' then v_state.approval_approved_by else p_requested_by end,
    case when p_environment = 'production' then v_state.approval_approved_at else now() end
  ) returning id into v_run_id;

  if p_environment = 'production' then
    update public.system_upstream_state
       set approval_consumed_at = now(), updated_at = now()
     where id = 1;
  end if;

  return v_run_id;
end
$fn$;

revoke all on function public.fn_crivo_dispatch_update(text,text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.fn_crivo_dispatch_update(text,text,uuid,text,text) to service_role;

notify pgrst, 'reload schema';
