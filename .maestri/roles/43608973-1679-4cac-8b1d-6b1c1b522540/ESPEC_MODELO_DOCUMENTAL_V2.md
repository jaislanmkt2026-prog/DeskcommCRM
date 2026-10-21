# Especificação Técnica — Modelo Documental Imobiliário (v2)

## Arquitetura: Separação CHECKLIST vs DOCUMENTO REAL

### 1. CHECKLIST (Configurável por Pipeline)
**Local:** `crm_pipelines.settings->'checklist_documental'` (jsonb)

Cada pipeline imobiliário define seus itens obrigatórios:
```json
{
  "checklist_documental": {
    "itens": [
      {"id": "rg_cnh", "label": "RG ou CNH", "obrigatorio": true},
      {"id": "cpf", "label": "CPF", "obrigatorio": true},
      {"id": "comprovante_renda", "label": "Comprovante de Renda", "obrigatorio": true},
      {"id": "certidao_nascimento", "label": "Certidão de Nascimento", "obrigatorio": false},
      {"id": "certidao_casamento", "label": "Certidão de Casamento", "obrigatorio": false}
    ]
  }
}
```

### 2. DOCUMENTO REAL (Arquivo Físico)
**Fluxo atual mantido:**
- Upload via conversa WhatsApp → bucket `whatsapp-media`
- Linha em `messages` com `media_storage_path`, `media_mime`, `media_size_bytes`
- Worker `media-persist-worker.ts` persiste o arquivo

### 3. VÍNCULO: Tabela `document_checklist_items`
Tabela leve que conecta checklist configurável aos documentos reais:

```sql
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

create index if not exists idx_doc_checklist_org on public.document_checklist_items (organization_id);
create index if not exists idx_doc_checklist_contact on public.document_checklist_items (contact_id);
create index if not exists idx_doc_checklist_status on public.document_checklist_items (status);
create index if not exists idx_doc_checklist_message on public.document_checklist_items (message_id);

-- Trigger updated_at
drop trigger if exists trg_doc_checklist_updated_at on public.document_checklist_items;
create trigger trg_doc_checklist_updated_at
  before update on public.document_checklist_items
  for each row execute function public.set_updated_at();

-- RLS
alter table public.document_checklist_items enable row level security;
drop policy if exists "tenant_isolation_document_checklist_items_all" on public.document_checklist_items;
create policy "tenant_isolation_document_checklist_items_all" on public.document_checklist_items
  for all using (organization_id in (select public.fn_user_org_ids()))
  with check (organization_id in (select public.fn_user_org_ids()));
```

## Fluxo de Qualificação Documental

### 3.1. Recebimento de Documento
1. Lead envia arquivo via WhatsApp
2. Worker persiste em `messages` com `media_storage_path`
3. Agente/Lia vincula manualmente: PATCH `/api/v1/contacts/{id}/documents/checklist`
   ```json
   {
     "checklist_key": "rg_cnh",
     "message_id": "<uuid-da-mensagem>"
   }
   ```
4. Sistema atualiza `document_checklist_items`:
   - `status = 'recebido'`
   - `recebido_em = now()`
   - `message_id = <uuid>`

### 3.2. Verificação de Completude
Query para verificar se lead tem todos os documentos obrigatórios:
```sql
select
  cdi.checklist_key,
  cdi.status,
  m.media_storage_path,
  m.media_mime
from document_checklist_items cdi
left join messages m on m.id = cdi.message_id
join crm_pipelines p on p.id = $pipeline_id
where cdi.contact_id = $contact_id
  and cdi.organization_id = $org_id
  and cdi.checklist_key in (
    select jsonb_array_elements_text(p.settings->'checklist_documental'->'itens'->>'id')
    where (p.settings->'checklist_documental'->'itens'->>'obrigatorio')::boolean = true
  );
```

### 3.3. Status Possíveis
- **pendente:** documento ainda não enviado
- **recebido:** arquivo vinculado via `message_id`
- **recusado:** documento enviado mas inválido (ex: foto borrada), exige reenvio

## Validações de Negócio

1. **Documento sem checklist:** `message_id` pode existir sem vínculo — documento avulso na conversa
2. **Checklist sem documento:** `message_id = null` indica pendência
3. **Reenvio:** ao receber novo arquivo para mesmo `checklist_key`, atualizar `message_id` e `recebido_em`
4. **Histórico:** manter `recusado_motivo` para feedback ao lead

## Vantagens desta Arquitetura

- **Sem migration 0385:** não altera tabela `documents` existente
- **Separação clara:** checklist é configuração, documento é arquivo físico
- **Rastreabilidade completa:** cada item aponta para a mensagem original
- **Flexibilidade:** pipeline define checklist sem mudar schema
- **RLS nativo:** tenant isolation em todas as tabelas

## Próximos Passos para BASE+CRIVO

1. Criar migration para tabela `document_checklist_items`
2. Adicionar validação Zod em endpoint de vínculo documental
3. Implementar UI no frontend para Lia gerenciar checklist
4. Atualizar worker de qualificação para verificar completude automática