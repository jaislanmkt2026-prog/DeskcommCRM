# Contrato de integração — Time Chaves e Squad100

**Status:** Missão 6 — integração controlada

## Fonte de verdade

O DeskcommCRM/Supabase é a única fonte canônica para dados comerciais:

- contatos e leads;
- conversas e mensagens;
- estado de atendimento e handoff;
- imóveis, disponibilidade e documentos;
- histórico/auditoria comercial.

`tasks.sqlite` do OpenClaw permanece permitido somente para:

- orquestração de tarefas;
- evidence gate;
- transições/delegações internas;
- heartbeat e filas internas;
- caches derivados explicitamente marcados como não canônicos.

As tabelas SQLite `crm_contacts`, `crm_conversations` e `crm_messages` são legado e não podem receber novas escritas por padrão.

## Time Chaves

O dashboard deve ler métricas comerciais do DeskcommCRM. Estados de tarefas continuam vindo de `tasks.sqlite`.

A API dedicada usa scopes independentes dos scopes MCP genéricos:

- `integration:time_chaves:read` — leitura do estado canônico resumido;
- `integration:time_chaves:write` — registro auditável de eventos de execução.

Eventos aceitos do Time Chaves são restritos a execução/evidência (`task.started`, `task.completed`, `task.failed`, `evidence.verified`). O endpoint não oferece escrita em preço, estoque, proposta, reserva, crédito ou estágio comercial.

## Squad100

Squad100 não possui banco próprio. Ele pode registrar no CRM somente metadados de artefatos produzidos, com scope `integration:squad100:write`.

Artefatos não são publicados automaticamente por este contrato. Aprovação/publicação continua fora do escopo desta fase.

## Idempotência e auditoria

Toda escrita externa exige `correlation_id`. O CRM deriva um identificador determinístico por tenant + origem + correlation_id, impedindo duplicação do mesmo evento.

Ações registradas:

- `integration.time_chaves.event_received`
- `integration.squad100.artifact_received`

O `organization_id` vem do token no banco, nunca do payload do agente externo.

## Segurança

Tokens de integração devem ter somente os scopes necessários. Não conceder `mcp:read`, `mcp:write` ou service role apenas para esta ponte.

O token deve ser provisionado pelo fluxo seguro de tokens do CRM e pode ser revogado/expirar normalmente.

## Fora de escopo

- captação ativa/cold outreach;
- Caixa e análise de crédito;
- proposta/reserva;
- migration 0383/0384/0385;
- alteração da Lia.

A ausência de captação ativa é backlog de produto e não bloqueia esta integração.

O checklist documental atual é a migration **0386**; a 0385 permanece vetada.
