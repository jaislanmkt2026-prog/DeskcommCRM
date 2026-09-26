-- 0416 — Crivo interno: estado e histórico de detecção do upstream.
--
-- São tabelas de INSTÂNCIA, sem organization_id. O objeto observado é o código
-- que roda o CRM inteiro; criar uma cópia por tenant daria estados divergentes
-- para a mesma instalação. RLS fica ligada e não há policy para anon/authenticated:
-- somente service_role, atrás das rotas protegidas do sistema, lê/escreve.

create table if not exists public.system_upstream_state (
  id smallint primary key default 1 check (id = 1),
  repository text not null default 'melgarafael/DeskcommCRM',
  default_branch text not null default '',
  local_commit text not null default '',
  last_seen_commit text not null default '',
  latest_upstream_commit text not null default '',
  last_seen_tag text not null default '',
  last_seen_release text not null default '',
  last_checked_at timestamptz,
  next_check_at timestamptz,
  update_available boolean not null default false,
  commits_behind integer not null default 0 check (commits_behind >= 0),
  files_changed integer not null default 0 check (files_changed >= 0),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  analysis_status text not null default 'never'
    check (analysis_status in ('never','no_change','completed','incomplete','failed')),
  analysis_summary jsonb not null default '{}'::jsonb check (jsonb_typeof(analysis_summary) = 'object'),
  updated_at timestamptz not null default now()
);

comment on table public.system_upstream_state is
  'Singleton de instância: último estado conhecido do Crivo interno contra o upstream público.';

insert into public.system_upstream_state (id) values (1) on conflict (id) do nothing;

create table if not exists public.system_upstream_checks (
  id uuid primary key default gen_random_uuid(),
  repository text not null default 'melgarafael/DeskcommCRM',
  default_branch text not null default '',
  local_commit text not null default '',
  upstream_commit text not null default '',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text not null default 'started'
    check (result in ('started','no_change','update_available','failed')),
  commits_delta integer not null default 0 check (commits_delta >= 0),
  commits_analyzed integer not null default 0 check (commits_analyzed >= 0),
  files_delta integer not null default 0 check (files_delta >= 0),
  files_analyzed integer not null default 0 check (files_analyzed >= 0),
  risk_level text not null default 'low' check (risk_level in ('low','medium','high','critical')),
  analysis_status text not null default 'never'
    check (analysis_status in ('never','no_change','completed','incomplete','failed')),
  events text[] not null default '{}',
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error text
);

comment on table public.system_upstream_checks is
  'Histórico de verificações read-only do upstream. Retenção aplicada pelo Crivo interno.';

create index if not exists idx_system_upstream_checks_started
  on public.system_upstream_checks (started_at desc);

alter table public.system_upstream_state enable row level security;
alter table public.system_upstream_checks enable row level security;

revoke all on table public.system_upstream_state from public, anon, authenticated;
revoke all on table public.system_upstream_checks from public, anon, authenticated;
grant select, insert, update, delete on table public.system_upstream_state to service_role;
grant select, insert, update, delete on table public.system_upstream_checks to service_role;

notify pgrst, 'reload schema';
