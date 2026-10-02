-- 0508: "O que chegou" em cada atualização do Crivo.
-- Uma linha por atualização aplicada: o que mudou, em linguagem do dono, e ONDE no CRM fica cada coisa.
-- Tabela da INSTALAÇÃO (não é de organização): só o service_role lê/escreve, como system_upstream_checks.
create table if not exists public.system_update_novidades (
  id uuid primary key default gen_random_uuid(),
  aplicada_em timestamptz not null default now(),
  de_sha text,
  para_sha text,
  titulo text not null,
  resumo text not null default '',
  itens jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.system_update_novidades is
  'O que chegou em cada atualização do Crivo: itens {tipo, titulo, onde:{menu,rota}, commit}. Escrita pelo ciclo do Crivo; lida pela tela Configurações > Atualização.';

create index if not exists idx_system_update_novidades_aplicada
  on public.system_update_novidades (aplicada_em desc);

alter table public.system_update_novidades enable row level security;
revoke all on table public.system_update_novidades from public, anon, authenticated;
grant select, insert, update, delete on table public.system_update_novidades to service_role;