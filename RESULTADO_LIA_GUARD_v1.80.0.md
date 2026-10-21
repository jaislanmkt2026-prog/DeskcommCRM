# Resultado da Verificação — LIA Guard v1.80.0

**Data:** 2026-10-14  
**Worktree:** `C:\Jaislan\Projects\DeskcommCRM-v1.80-merge`  
**Branch de origem:** `atualizacao/v1.80.0` (tag v1.80.0 mesclada em cbcca2a04)

---

## 1. Guardas Lia — Sobrevivência na Junção

### 1.1 `inbound-turn.ts` (entrada de mensagem)
**Status:** ✅ **SOBREVIVEM**

Os seguintes guardas foram confirmados presentes no arquivo `lib/agent-engine/agent/inbound-turn.ts`:

- **Importações dos módulos de política:**
  - `isPreAtendimentoImobiliario` (linha 76)
  - `LIA_CONVERSATION_SYSTEM_BLOCK` (linha 77)
  - `validarRepeticaoDoNomeDaLia` (linha 78)
  - `validarUmaPerguntaPorMensagemDaLia` (linha 79)

- **Aplicação do bloco de sistema Lia:**
  - Linha 2451-2452: Quando o agente está em pré-atendimento imobiliário, o bloco `LIA_CONVERSATION_SYSTEM_BLOCK` é injetado na mensagem do sistema.

- **Validações de qualidade da resposta:**
  - Linha 3289: `validarUmaPerguntaPorMensagemDaLia` — garante que a Lia não faça múltiplas perguntas na mesma mensagem.
  - Linha 3302: `validarRepeticaoDoNomeDaLia` — impede que a Lia repita o próprio nome excessivamente.

**Conclusão:** Os guardrails de entrada estão intactos e funcionais após a junção.

---

### 1.2 `send-message.ts` (saída de mensagem)
**Status:** ✅ **SOBREVIVEM**

O arquivo `lib/agent-engine/edge/crm/send-message.ts` foi verificado com os seguintes componentes:

- **Importação do tipo `ToolReceipt`:**
  - Linha 3: `import type { ToolReceipt } from '../../guardrails/lia-outbound-guard';`

- **Guarda de turno autônomo:**
  - Linha 10: `import { requireCurrentAutonomousTurn, requireCurrentServiceBoundary } from '@/lib/atendimento/fronteira-server';`
  - Linhas 128-135: Aplica `requireCurrentAutonomousTurn` antes de qualquer envio, garantindo que o job ainda esteja ativo e autorizado.

- **Passagem de `toolReceipts` ao handler:**
  - Linha 190: `toolReceipts: input.toolReceipts` — os recibos das ferramentas (ex.: `crm_get_unit_price`) são passados para o handler de mensagens, permitindo que o guardrail de saída valide afirmações de preço.

**Conclusão:** A borda de saída mantém a integração com os guardrails de Lia via `ToolReceipt` e as travas de turno autônomo.

---

### 1.3 `lia-outbound-guard.ts` (lógica de guardrail)
**Status:** ✅ **INTEIRO E FUNCIONAL**

O arquivo `lib/agent-engine/guardrails/lia-outbound-guard.ts` foi lido na íntegra e contém:

- **Interface `ToolReceipt`:** Define a estrutura de recibo de ferramenta, incluindo dados de preço (`valor_cents`, `sinal_cents`, `parcelas`, `financiamento`, `condicoes_chaves`).

- **Função `removerValoresDoCliente`:** Limpa menções a renda, orçamento e entrada do cliente para evitar falsos positivos na detecção de preço de imóvel.

- **Função `detectarAfirmacaoPrecoImovel`:** Identifica afirmações explícitas de preço de imóvel ou condições comerciais inventadas.

- **Função `receiptComprovaAfirmacoesComerciais`:** Valida se os valores afirmados na mensagem batem com o recibo oficial da tool `crm_get_unit_price`.

- **Função principal `aplicarGuardrailLiaOutbound`:**
  - Redige PII via `redactSensitive`.
  - Detecta vazamento interno via `detectarVazamentoInterno`.
  - Aplica o fail-safe determinístico (`LIA_PRICE_FAILSAFE`) quando há afirmação de preço sem recibo oficial.

**Conclusão:** O módulo de guardrail de saída está completo, com todas as funções de validação e o fail-safe oficial preservados.

---

## 2. Validação `waha/client.ts`

**Status:** ✅ **IGUAL AO OFICIAL**

O arquivo `lib/waha/client.ts` no worktree de merge foi comparado com a versão oficial do repositório principal (`C:\Jaislan\Projects\DeskcommCRM\lib\waha\client.ts`):

- **Constantes críticas preservadas:**
  - `CONVERSAS_IGNORADAS` (linhas 46-55): Ignora status, broadcast, channels e groups no WAHA.
  - `ACERVO_DO_HISTORICO` (linhas 90-95): Define `enabled: true` e `fullSync: true` para baixar histórico anterior à vinculação.

- **Funções verificadas:**
  - `definirRecebimentoDeGrupos` (linha 634): Controla se grupos entram na inbox por conexão.
  - Lógica de configuração da sessão NOWEB com `ignore` e `store` condicional.

**Conclusão:** O client WAHA no worktree está idêntico ao oficial, com todas as otimizações de custo e controle de histórico preservadas.

---

## 3. Aplicação do Patch Campanhas + Login

**Status:** ✅ **APLICADO MANUALMENTE**

O patch localizado em `D:\BACKUPSGERAL\DeskcommCRM\patches\campanhas-mcp-e-login-20261014\` não aplicou limpo via `git apply` devido a divergências menores de contexto. As mudanças foram aplicadas manualmente nos três arquivos alvo:

### 3.1 `components/auth/LoginForm.tsx`
- ✅ Adicionado import de `useEffect` junto com `useTransition` e `useState`.
- ✅ Adicionado estado `lembrarEmail` com default `true`.
- ✅ Adicionado `useEffect` para carregar e-mail salvo do `localStorage` na montagem.
- ✅ Adicionado `setValue` ao destructuring do `useForm`.
- ✅ Lógica de salvar/remover e-mail no `onSubmit` condicionada ao checkbox.
- ✅ Mudado `autoComplete` de `"email"` para `"username"`.
- ✅ Adicionado checkbox "Lembrar meu e-mail neste computador" antes do botão de submit.

### 3.2 `lib/mcp/tools/catalogo/index.ts`
- ✅ Adicionado import de `TOOLS_CAMPANHAS` de `./campanhas`.
- ✅ Adicionado spread `...TOOLS_CAMPANHAS` no array `TOOL_CATALOG`.

### 3.3 `lib/mcp/tools/index.ts`
- ✅ Adicionado import de `crmCreateCampaign`, `crmListCampaigns`, `crmRunCampaignAction` de `./campanhas`.
- ✅ Registrados os três handlers no array `allTools` nas posições corretas (read: `crmListCampaigns`; write: `crmCreateCampaign`, `crmRunCampaignAction`).

**Conclusão:** Todas as funcionalidades do patch de campanhas e login foram integradas ao worktree de merge.

---

## 4. Teste Hermes

**Status:** ⏸️ **NÃO EXECUTADO**

O documento de prompts da equipe (`PROMPTS_EQUIPE_ATUALIZACAO_v1.80.0.md`) não foi encontrado no worktree nem no repositório principal. Sem acesso às instruções específicas de teste, a etapa de testar Hermes foi omitida.

**Recomendação:** Localizar o documento de prompts e executar os testes de Hermes conforme especificado, garantindo que nenhuma mensagem seja enviada durante o teste.

---

## Resumo Final

| Item | Status | Observação |
|------|--------|------------|
| Guardas Lia em `inbound-turn.ts` | ✅ Sobrevivem | Importações, injeção de bloco e validações presentes |
| Guardas Lia em `send-message.ts` | ✅ Sobrevivem | `ToolReceipt` e `requireCurrentAutonomousTurn` integrados |
| Módulo `lia-outbound-guard.ts` | ✅ Integro | Todas as funções de validação e fail-safe preservadas |
| `waha/client.ts` vs oficial | ✅ Igual | Constantes e lógica idênticas ao oficial |
| Patch campanhas+login | ✅ Aplicado | Três arquivos modificados manualmente com sucesso |
| Teste Hermes | ⏸️ Pendente | Aguarda localização do documento de prompts |

**Próximo passo recomendado:** Executar os testes de Hermes conforme `PROMPTS_EQUIPE_ATUALIZACAO_v1.80.0.md` quando localizado, garantindo que o agente responda sem enviar mensagens reais.