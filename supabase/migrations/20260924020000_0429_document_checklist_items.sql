-- 0425 — document_checklist_items (Modelo Documental Imobiliário v2)
--
-- Tabela leve que conecta checklist configurável (crm_pipelines.settings->'checklist_documental')
-- aos documentos reais (messages.media_storage_path).
--
-- Arquitetura: Separação CHECKLIST vs DOCUMENTO REAL
-- - Checklist é configuração por pipeline (jsonb)
-- - Documento é arquivo físico em messages (bucket whatsapp-media)
-- - document_checklist_items faz o vínculo entre os dois
--
-- Idempotente, portável em psql puro (sem BEGIN/COMMIT, sem temp tables).

-- ─── 1. document_checklist_items ─────────────────────────────────────────────
create table if not exists public.document_checklist_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  checklist_key text not null, -- ex: "rg_cnh", "cpf"
  message_id uuid references public.messages(id) on delete set null, -- documento real
  status text not null default 'pendente' check (status in ('recebido', 'pendente', 'recusado')),
  recebido_em timestamptz,
  recusado_motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_checklist_contact_key unique (contact_id, checklist_key)
);

comment on table public.document_checklist_items is 'Vínculo entre itens de checklist documental configurável e documentos reais (mensagens).';
comment on column public.document_checklist_items.checklist_key is 'Chave do item de checklist (ex: "rg_cnh", "cpf") definida em crm_pipelines.settings->''checklist_documental''.';
comment on column public.document_checklist_items.message_id is 'Referência ao documento real (mensagem com media_storage_path).';
comment on column public.document_checklist_items.status is 'Estado do item: pendente (não enviado), recebido (vinculado), recusado (inválido).';
comment on column public.document_checklist_items.recebido_em is 'Timestamp do recebimento do documento.';
comment on column public.document_checklist_items.recusado_motivo is 'Motivo da recusa para feedback ao lead.';

-- Índices para consultas frequentes
create index if not exists idx_doc_checklist_org on public.document_checklist_items (organization_id);
create index if not exists idx_doc_checklist_contact on public.document_checklist_items (contact_id);
create index if not exists idx_doc_checklist_status on public.document_checklist_items (status);
create index if not exists idx_doc_checklist_message on public.document_checklist_items (message_id);

-- ─── 2. Trigger updated_at ──────────────────────────────────────────────────
drop trigger if exists trg_doc_checklist_updated_at on public.document_checklist_items;
create trigger trg_doc_checklist_updated_at
  before update on public.document_checklist_items
  for each row execute function public.fn_touch_updated_at();

-- ─── 3. RLS tenant isolation ────────────────────────────────────────────────
alter table public.document_checklist_items enable row level security;
drop policy if exists "tenant_isolation_document_checklist_items_all" on public.document_checklist_items;
create policy "tenant_isolation_document_checklist_items_all" on public.document_checklist_items
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));