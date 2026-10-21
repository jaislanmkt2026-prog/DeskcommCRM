-- 0385 — extensão de documents para checklist documental da Lia
--
-- JUSTIFICATIVA: A tabela documents (migration 0382) possui apenas campos básicos
-- (tipo, storage_path, observacoes). O contrato da BÚSSOLA (§7) exige status
-- (recebido/pendente/recusado_reenvio), data de recebimento, origem do documento
-- e vínculo com item de checklist para que a Lia possa acompanhar documentação
-- pré-handoff. Sem estas colunas, a Lia não consegue distinguir "documento recebido"
-- de "documento pendente", impossibilitando o fluxo de qualificação documental.
--
-- REUTILIZAÇÃO: Qualificação imobiliária (finalidade, tipo_imovel, faixa_valor, etc.)
-- usa crm_leads.custom_fields (jsonb com GIN já existente no baseline).
-- passagens_de_atendimento já possui estrutura completa de handoff (title, body,
-- notes, content, tentativas, motivo_codigo, motor, origem) — sem alteração.
--
-- Idempotente, portável em psql puro. Não altera migrations 0382/0383/0384.

-- ─── 1. Extensão de documents ────────────────────────────────────────────────
alter table public.documents
  add column if not exists status text not null default 'pendente'
    check (status in ('recebido', 'pendente', 'recusado_reenvio')),
  add column if not exists recebido_em timestamptz,
  add column if not exists origem_documento text
    check (origem_documento in ('whatsapp', 'email', 'portal', 'manual', 'outro')),
  add column if not exists checklist_item text,
  add column if not exists updated_at timestamptz not null default now();

comment on column public.documents.status is
  'Status do documento no checklist: recebido (upload confirmado), pendente (aguardando), recusado_reenvio (solicitado novo envio).';
comment on column public.documents.recebido_em is
  'Data/hora em que o documento foi recebido/confirmando pela Lia ou manualmente.';
comment on column public.documents.origem_documento is
  'Canal de origem do documento: whatsapp (upload na conversa), email, portal, manual (upload via CRM), outro.';
comment on column public.documents.checklist_item is
  'Identificador do item de checklist configurável ao qual este documento corresponde (ex.: rg_cnh, cpf, comprovante_renda). Null se fora de checklist.';
comment on column public.documents.updated_at is
  'Última atualização do registro (trigger set_updated_at).';

-- ─── 2. Trigger updated_at para documents ────────────────────────────────────
drop trigger if exists trg_documents_updated_at on public.documents;
create trigger trg_documents_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- ─── 3. Índice para consultas de checklist por entidade ──────────────────────
create index if not exists idx_documents_checklist_status
  on public.documents (entity_kind, entity_id, status);

-- ─── 4. Backfill: documentos existentes recebem status='recebido' ────────────
-- Documentos criados antes desta migration foram uploads confirmados (não havia
-- conceito de pendente). Status default 'pendente' seria incorreto para eles.
update public.documents
  set status = 'recebido',
      recebido_em = created_at
  where status = 'pendente'
    and recebido_em is null
    and storage_path is not null;