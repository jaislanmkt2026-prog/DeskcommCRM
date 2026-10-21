# Atualização do DeskcommCRM para a v1.80.0 — prompts da equipe Maestri

Gerado por Claude Code em 14/10/2026, a pedido do Jaislan ("quero o CRM atualizado").
Cole o **BLOCO COMUM** em cada agente, seguido da **TAREFA** dele.

---

## BLOCO COMUM (todos leem antes de agir)

**Objetivo.** Atualizar o DeskcommCRM que roda em `https://localhost` para a **v1.80.0** (última versão oficial, 11/10/2026)
**sem perder nenhuma customização do dono** (CV CRM Missão 8, módulo imobiliário, guardas da Lia, RBAC, LGPD imobiliária,
aba Leads, tela "O que chegou nas atualizações", Crivo). O Jaislan autorizou a atualização em 14/10/2026.
**Subir o CRM novo (trocar containers) exige o "sim" explícito do Jaislan, pedido pelo Chefe.**

**Onde está cada coisa (NÃO mexer fora disto):**
| O quê | Caminho |
|---|---|
| Cópia de trabalho da junção (branch `atualizacao/dono-v1.80.0`, merge em andamento, 18 conflitos já resolvidos e em stage) | `C:\Jaislan\Projects\DeskcommCRM-v1.80-merge` |
| Versão antiga do dono, sem junção (tip `c9cc73f21`) — só para comparar | `C:\Jaislan\Projects\DeskcommCRM-base` |
| v1.80.0 oficial pura — só para comparar | `C:\Jaislan\Projects\DeskcommCRM-off` |
| Pasta principal (branch `system/crivo-update-center`) | `C:\Jaislan\Projects\DeskcommCRM` — **NÃO** rodar `reset`, `checkout`, `clean` nem `stash` nela. Às 11:44 um processo fez `reset --hard` para o upstream aqui e tirou 53 commits do dono do HEAD. Eles estão salvos nas branches `ciclo/*` (tip `c9cc73f21`). |
| Backup do banco real (pg_dump -Fc, 9,3 MB, íntegro) | `D:\BACKUPSGERAL\DeskcommCRM\pre-v1.80-banco-real\` |
| Ponto de retorno da imagem do app | `deskcomm-local:app-pre-v1.80-20261014` |
| Banco de ensaio (cópia do real, descartável) | container `scratch-pg` (pgvector/pgvector:pg17); remover no fim: `docker rm -f scratch-pg` |
| Patch das ferramentas de campanha + botão do login (reaplicar DEPOIS da junção) | `D:\BACKUPSGERAL\DeskcommCRM\patches\campanhas-mcp-e-login-20261014\` |

**Já feito (não refazer):**
1. Merge `v1.80.0` → linha do dono: 18 conflitos resolvidos. Estratégia: arquivos com diferença só de formatação = versão oficial + reaplicar a lógica do dono.
2. `supabase/baseline.sql` = baseline oficial + bloco do dono (2.088 linhas, inserido antes do marcador `VARREDURA anon`) + função `fn_lgpd_cascade_redact_contact` **unificada** (passos da oficial + passos 9–11 e `lead_notes` do dono).
3. Ensaio do baseline no `scratch-pg` (cópia do banco real): passada estrita `ON_ERROR_STOP=1` com **0 erros**; dados iguais (929 contatos, 924 leads, 5 organizações, 10 usuários).
4. 10 migrations do dono colidiam de número com as da oficial → renumeradas para **0645–0654** (timestamps mantidos; 0654 passou a `20261004120001` por colisão de timestamp com a 0537). `supabase/migrations/MANIFEST.md` atualizado. O banco não registra versões de migration (o baseline é re-aplicado idempotente), então renomear é seguro.
5. Dicionário `lib/i18n/dicionario.ts` = oficial + 97 chaves que só o dono tinha.
6. `lib/lgpd/copia-do-titular.ts`: acrescentadas as seções `imob_checklist`, `imob_negociacoes`, `imob_propostas` em `O_QUE_FICA`; fixtures `tests/fixtures/lgpd-brasil-antes-do-doc88/data-*.json` atualizadas.
7. `lib/ai/runtime/escopo-das-escritas.ts`: 4 ferramentas imobiliárias registradas + 2 tipos de dono novos (`item_do_checklist`, `mensagem`).
8. `lib/cv-crm/ingest.ts` usa `randomId()`; exceção declarada para `app/api/v1/system/cv-crm/metrics/route.ts` em `tests/unit/admin-client-exige-filtro-de-tenant.test.ts`.
9. `lib/waha/client.ts` voltou ao oficial (removido `media.autoDownload`, campo não documentado que o dono tinha por um commit de checkpoint).
10. `package.json`: `test:shell` = lista oficial + `update-lock-real` + `update-postgres-rollback-real`.
11. `tsc --noEmit`: **0 erros**.

**Resultado da suíte completa (vitest, antes dos últimos ajustes):** 22.693 passaram, 142 falharam em 56 arquivos.
32 deles falham também na versão antiga (ambiente Windows: bash/git/python/pdfjs). Os 24 que falhavam só após a junção foram
reduzidos a ~15 depois dos ajustes acima — **ver a tarefa do Farol QA**.

**Regras de ouro (valem para todos):**
- Trabalhar **só** nas 3 cópias acima. Cada arquivo tem um agente dono (ver tarefas); se precisar editar arquivo de outro, peça a ele.
- **Nada de `git push`, deploy, `docker compose up/down/restart` nem `docker stop/rm` em containers de produção** sem ordem do Chefe + "sim" do Jaislan. Comandos de leitura (`ps`, `logs`, `inspect`, `psql` no `scratch-pg`) são livres.
- **Nunca** enviar mensagem de WhatsApp a cliente. Nunca digitar nem exibir senha, token ou chave. `.env`, `.env.local` e `.e2e-creds.json` só leitura, e nunca imprimir valores.
- Backup/arquivo gerado → somente `D:\BACKUPSGERAL\DeskcommCRM\` (subpasta própria). Relatórios → `C:\Users\okaso\Desktop\Relatorio Maestri\`.
- Commit **só o Chefe**, na branch `atualizacao/dono-v1.80.0` do worktree de junção, nunca `git add -A`.
- Português do Brasil, sem jargão, ao falar com o Jaislan.
- Terminou ou travou? Escreva o resultado em `Relatorio Maestri\RESULTADO_<seu_nome>_v1.80.0.md` (feito, falhou, pendente, comandos exatos) e avise o Chefe.

---

## TAREFA — CHEFE (coordenação)

1. Dono do commit. Quando Farol QA e Atlas CV declararem a suíte verde (exceto os falhos de ambiente já catalogados), rode `git commit` do merge no worktree de junção (mensagem: `merge: atualizacao para v1.80.0 preservando CV CRM, imobiliario, Lia, RBAC e LGPD do dono`).
2. Distribua e acompanhe as 6 tarefas abaixo; resolva conflito de arquivo entre agentes.
3. **Reaplicar o patch** de `D:\BACKUPSGERAL\DeskcommCRM\patches\campanhas-mcp-e-login-20261014\` no worktree de junção (entregue a Lia Guard, veja a tarefa dela) ANTES do commit final.
4. Quando tudo estiver verde: monte o relatório de decisão para o Jaislan (o que muda para ele, risco, rollback, tempo de parada ~minutos) e **peça o "sim"**. Só então autorize a Fortaleza a executar o plano de troca.
5. Entregue ao Jaislan um relatório final em `Relatorio Maestri\` e um resumo de 10 linhas no chat.

## TAREFA — FAROL QA (QA Auditor) — dono de `tests/**` (exceto os ajustes de dono listados nas outras tarefas)

1. No `DeskcommCRM-off` (v1.80.0 pura), rode os 56 arquivos listados em `%TEMP%\falhos.txt` (se sumiu, gere de novo pela saída `%TEMP%\vitest-merge.out`). Classifique cada falha: **(A)** falha também na oficial pura = ambiente Windows, só documentar; **(B)** passa na oficial e falha na junção = regressão da junção, corrigir.
2. Falhas já vistas, a investigar/fechar (todas no worktree de junção):
   - `tests/unit/conversao-pelo-canal.test.ts` — "conexão direta ligada" devolve `skipped/recusado_pela_plataforma` em vez de `ok`. Handler e teste são idênticos à oficial; descubra a causa (suspeita: dependência fora de `lib/conversoes` que difere da oficial; compare com `DeskcommCRM-off`).
   - `tests/unit/branding.test.ts` — lista de hosts (`api.github.com` do Crivo + `chatgpt.com` da oficial): confirmar que as duas entradas estão corretas e o teste verde.
   - `tests/unit/apendice-do-baseline-nao-diverge-da-cadeia.test.ts` — a última definição de `fn_lgpd_cascade_redact_contact` na cadeia de migrations (a da oficial, mais nova) difere da do apêndice do baseline (a unificada). **Solução prevista:** criar a migration `0655_lgpd_cascade_unificada` (timestamp maior que todas) com o corpo unificado, igual ao do baseline. Trabalhe junto com a Fortaleza (banco) e atualize `MANIFEST.md`.
   - `tests/unit/baseline-nao-constroi-o-que-derruba.test.ts` e `sem-marcador-de-conflito.test.ts` — estouraram 15 s; rode isolados, e se for só lentidão do Windows, documente (não aumente o teto sem avisar o Chefe).
   - `tests/unit/agent-version-columns-drift.test.ts`, `servidor-nao-importa-valor-de-modulo-cliente`, `chip-contraste-da-etiqueta`, `dialog-base-roda-e-tem-teto`, `lgpd-pdf-*` — suspeita de caminho com barra invertida/Windows; confirmar na oficial pura.
3. Rode a suíte completa de novo (`npx vitest run --reporter=dot`, ~17 min, saída para arquivo) e entregue a tabela final: arquivo | falha | classe A/B | decisão.
4. Meta: **zero falhas classe B**.

## TAREFA — ATLAS CV (CV CRM Missão 8)

1. Garanta que tudo da Missão 8 sobreviveu: migrations `0651_cv_crm_external_id`, `0652_cv_crm_staging_ingestion`, `0653_fn_apply_cv_crm_valid_records` (renumeradas), `lib/cv-crm/*`, `app/api/v1/cron/cv-crm-*`, `app/api/v1/system/cv-crm/*`, `tests/invariants/cv-crm-staging.test.ts`.
2. No `scratch-pg` (já com o baseline novo), confirme que `cv_crm_staging`, `cv_crm_ingestion_logs`, `fn_apply_cv_crm_valid_records` existem e rode os invariantes de CV CRM que precisam de banco (`bash scripts/test-db.sh` ou o runner equivalente do projeto, apontando para o `scratch-pg`; **nunca** para o `supa-db` real).
3. Revise (não reescreva) as 3 mudanças que o Claude fez no seu domínio: `randomId()` em `lib/cv-crm/ingest.ts`; exceção em `admin-client-exige-filtro-de-tenant.test.ts`; e as 3 seções `imob_*` do export LGPD. Se discordar, escreva o motivo.
4. O arquivo `app/api/v1/system/cv-crm/metrics/route.ts` tem comentários com texto corrompido (`Ãºltimas`): corrija a codificação para UTF-8 sem mudar a lógica.

## TAREFA — RELÓGIO (Automações)

1. Revise `lib/relogio/executar.ts` (foi resolvido com a versão **oficial**, que corta no banco com `organizations!inner(status)`), `lib/event-log/*` e os crons. O worker do CRM registrou `event-log drain: tick scanned:1 failed:1` — descubra o que falhou (log: `docker logs deskcommcrm-worker-1`, só leitura) e se já existia antes.
2. Diga, com evidência, se `deskcommcrm-scheduler-1` (parado há 2 semanas, exit 137) deve voltar a rodar na versão nova e o que ele faz.
3. Rode os testes de automação/cron: `cron-respeita-org-operante`, `followup`, `relogio*`. Os que já falham na versão antiga do dono são ambiente; os demais, corrigir.
4. Entregue o plano de **ordem de subida**: o worker (imagem `deskcomm-local:worker`, de 3 semanas) tem de subir junto com o app novo — descreva compatibilidade de fila/jobs entre a imagem velha e a nova.

## TAREFA — FORTALEZA (Segurança e Infra) — dona do banco e do Docker

1. **Plano de troca por escrito** (não executar): (a) conferir que o dump em `pre-v1.80-banco-real` abre (`pg_restore -l`); (b) aplicar `supabase/baseline.sql` no banco real exatamente como `reaplicar_baseline` do `hostgator-setup-kit/_common.sh` faz (`psql -q -f`, até 3 passadas, erros benignos = `already exists|multiple primary keys|...`); (c) compilar as **3 imagens** (app, worker, scheduler) do worktree de junção com `docker compose -f docker-compose.prod.yml -f docker-compose.build.yml build`, usando as variáveis de imagem (`APP_IMAGE`, `WORKER_IMAGE`, `SCHEDULER_IMAGE`) do `.env` da pasta principal **sem imprimir valores** — copie o `.env` só para o worktree, nunca para o Git; (d) trocar containers; (e) health check; (f) **rollback**: religar imagem `deskcomm-local:app-pre-v1.80-20261014` e, se o banco precisar, restaurar o dump.
2. Rode no `scratch-pg` uma **segunda** passada do baseline (idempotência) e meça o tempo.
3. Revise a segurança das 3 mudanças do Claude no seu domínio: `lib/ai/runtime/escopo-das-escritas.ts` (donos `item_do_checklist` e `mensagem`), a exceção em `admin-client-exige-filtro-de-tenant.test.ts` e o `restore.sh`/`backup.sh` do kit.
4. Confirme que os containers do CRM ficaram com `restart=unless-stopped` (foi aplicado hoje em `supa-*`, app, caddy, srh, worker).
5. Lembre ao Jaislan (no relatório) de **trocar senhas/chaves que foram coladas em chats** hoje; não repita os valores.

## TAREFA — VIGIA RELEASE (Observabilidade e Release)

1. Leia os changelogs v1.69 → v1.80 (`CHANGELOG.md` do worktree de junção e https://github.com/melgarafael/DeskcommCRM/releases) e liste, em português simples, **o que muda para o Jaislan** e **os passos obrigatórios**. Já sabemos: v1.78 — reconectar a assinatura do ChatGPT em IA › Credenciais, rota global do webhook do WAHA devolve 404 a proxies de borda, colunas `rate_limit_rps`/`ai_budget_cents` saem do banco, `situacao` ganha `nao_disparado`; v1.79 — pedidos de integrações passam a `origin=external` (conferir se há ponte do dono gravando outro nome), variável `CODEX_CLIENT_VERSION`; v1.80 — reconstrução de dados de playbooks.
2. Confirme marcadores de versão: `APP_VERSION=1.80.0` já está no `.env.local` da pasta principal (o app antigo diz 1.80.0 sem ser). Garanta que depois da troca a versão exibida e a real coincidam.
3. Monte o **checklist de fumaça pós-troca** (login em `https://localhost/login` com `jaislan@deskcomm.local`; Inbox/WhatsApp; funil; agenda; Campanhas; Configurações › Atualização; MCP com o Hermes; Crivo) e o **monitor** de 30 minutos depois da troca (logs de app/worker, erros 5xx, fila de eventos).
4. Verifique a tela "O que chegou nas atualizações" (tabela `0650_novidades_da_atualizacao`): registrar a entrada da v1.80.0 sem inventar conteúdo.

## TAREFA — LIA GUARD (Lia e WhatsApp)

1. Confirme que as guardas da Lia sobreviveram à junção: `lib/agent-engine/agent/inbound-turn.ts` (mantém `toolReceiptsThisTurn` **e** `followupAgendadoNesteTurno`), `lib/agent-engine/edge/crm/send-message.ts` (`ToolReceipt`/`toolReceipts`), `lib/agent-engine/guardrails/lia-outbound-guard*`, `tests/unit/lia-*`. Rode todos os testes `lia`/`guardrail`.
2. WhatsApp: `lib/waha/client.ts` está igual à oficial (sem `autoDownload`). Confirme que a conexão/estado do canal existente não depende disso e que `waha-sessao-nasce-com-o-acervo` passa. **Não** mexer em sessão WAHA em produção.
3. **Reaplicar o patch** do Jaislan (ferramentas de campanha do MCP para o Hermes + checkbox "Lembrar meu e-mail" do login) no worktree de junção, partindo dos arquivos em `D:\BACKUPSGERAL\DeskcommCRM\patches\campanhas-mcp-e-login-20261014\`: copiar `lib/mcp/tools/campanhas.ts` e `lib/mcp/tools/catalogo/campanhas.ts`; acrescentar o import `TOOLS_CAMPANHAS` + spread em `lib/mcp/tools/catalogo/index.ts`; acrescentar `crmListCampaigns`, `crmCreateCampaign`, `crmRunCampaignAction` em `lib/mcp/tools/index.ts`; reaplicar o `LoginForm.tsx` (checkbox + `autoComplete="username"`). Pacote do catálogo = `organizar` (o `vender` é o padrão do onboarding e não aceita ferramenta só de gerente). Depois: `tsc`, `catalogo-tools-leigo-friendly`, `capacidade-alcancavel-pelo-agente`, `capacidades-padrao-do-onboarding`, `PasswordVisibility.test.tsx`.
   - Atenção: o catálogo agora também tem o domínio imobiliário (`catalogo/imobiliario.ts`) — confira que os 4 `crm_*` imobiliários e as 3 de campanha convivem sem colisão de nome.
4. Teste de aceitação do Hermes (só leitura, **sem enviar nada**): com o app novo no ar, `crm_list_campaigns` responde; `crm_create_campaign` cria rascunho; `crm_run_campaign_action` **não** é chamado em produção sem ordem do Jaislan.

---

## Ordem sugerida

1. Farol QA + Atlas CV + Relógio + Lia Guard trabalham em paralelo (arquivos diferentes).
2. Fortaleza prepara o plano e ensaia; Vigia Release prepara changelog e checklist.
3. Chefe consolida, comita o merge, pede o "sim" do Jaislan, autoriza a Fortaleza.
4. Fortaleza troca; Vigia Release roda a fumaça e o monitor; Lia Guard confirma o Hermes.
5. Se algo falhar: rollback da Fortaleza e relatório.
