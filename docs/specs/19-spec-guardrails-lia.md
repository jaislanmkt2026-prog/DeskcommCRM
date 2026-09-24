# Spec 19 — Guardrails LIA (Agente de Qualificação Imobiliária)

**Status:** aprovado  
**Escopo:** agente Lia que atende leads imobiliários via WhatsApp, coleta qualificação e documentação.  
**Não-objetivos:** regras genéricas de outros agentes (cobertas por specs próprias).

---

## 1. Redaction de dados sensíveis em logs e respostas

### 1.1 Dados-alvo
- **CPF:** padrão `XXX.XXX.XXX-XX` ou 11 dígitos consecutivos
- **RG:** padrões variados (ex: `XX.XXX.XXX-X`, `X.XXX.XXX`)
- **Telefone:** `(XX) XXXXX-XXXX` ou variações
- **E-mail:** padrão `usuario@dominio.tld`

### 1.2 Regras de redaction
1. **Antes do log:** qualquer função de logging (`console.log`, `logger.info`, etc.) que receba texto bruto de conversa, payload de webhook ou resposta da IA deve passar por `redactSensitive()` antes de emitir.
2. **Antes da resposta ao usuário:** a camada de entrega (`deliverReply` / `sendTemplate`) aplica `redactSensitive()` no corpo final antes de chamar o adapter do canal.
3. **Formato da máscara:** substituir por `[REDACTED:<tipo>]` onde `<tipo>` é `cpf`, `rg`, `phone`, `email`. Exemplo: `"CPF 123.456.789-00"` → `"CPF [REDACTED:cpf]"`.

### 1.3 Implementação
- Função central `lib/agent-engine/guardrails/redact-pii.ts` exportando `redactCPF(text)`, `redactRG(text)` e `redactSensitive(text)`.
- Regex por tipo, aplicadas em ordem (CPF antes de RG para evitar falso positivo).
- Teste unitário obrigatório cobrindo: CPF válido/inválido, RG com/sem pontos, telefone com/sem DDD, e-mail com subdomínio.

---

## 2. Bloqueio de vazamento interno

### 2.1 Dados proibidos em respostas visíveis ao lead
- **`organization_id`:** UUID de tenant
- **Tokens de API:** padrões `dsk_*`, `whatsapp_*`, chaves Supabase
- **Caminhos internos:** `storage_path`, URLs assinadas do bucket `whatsapp-media`
- **IDs internos:** `message_id`, `conversation_id` quando não forem parte da UX explícita

### 2.2 Regras de bloqueio
1. **Before-send gate:** toda resposta da Lia passa por `guardInternalLeak(response: string): { safe: boolean, sanitized: string }`.
2. **Detecção por padrão:** regex para UUID (`[0-9a-f]{8}-...`), prefixos de token conhecidos, paths `/orgs/`, `storage/`.
3. **Ação:** se detectar vazamento, substituir por `[BLOQUEADO]` e registrar métrica `lia.leak_blocked`.

### 2.3 Implementação
- Usar função existente `lib/agent-engine/guardrails/vazamento-interno.ts` (`detectarVazamentoInterno`).
- Adicionar regras específicas para tokens (`dsk_`, `eyJ`) e paths internos.
- Chamada obrigatória em `app/api/v1/messages/_handler.ts` antes de `deliverReply()`.
- Métrica emitida via `lib/metrics/emit.ts`.

---

## 3. Bloqueio before-send para estimativa de preços

### 3.1 Cenário de risco
A Lia pode ser tentada a dar estimativa de preço de imóvel sem consultar a tabela de preços vigente, gerando informação incorreta e exposição legal.

### 3.2 Regra de bloqueio
1. **Gatilho:** sempre que a Lia for produzir uma resposta contendo valores monetários relacionados a imóvel (palavras-chave: "preço", "valor", "custa", "R$", "milhões"), o sistema deve interceptar.
2. **Verificação:** chamar tool `crm_get_unit_price(unit_id: uuid, organization_id: uuid)` que consulta `real_estate_price_list_items` com preço vigente.
3. **Decisão:**
   - Se `ok: true` → permitir envio com o preço retornado.
   - Se `ok: false` (sem preço vigente ou tabela inexistente) → bloquear a estimativa, substituir resposta por template: *"O valor desta unidade está sendo atualizado. Vou verificar e te informo em breve."*

### 3.3 Implementação
- Tool `crm_get_unit_price` em `lib/mcp/tools/imobiliario.ts` já retorna `ok: false` se sem preço vigente.
- Adicionar validação de existência da tabela `real_estate_price_lists` antes de consultar. Se tabela não existir, retornar `{ ok: false, error: "Tabela de preços não configurada" }`.
- Hook before-send em `_handler.ts` chamando `getUnitPrice()` quando detectar gatilho de preço.

---

## 4. Métricas de observabilidade

| Métrica | Tipo | Descrição |
|---------|------|-----------|
| `lia.redaction_applied` | counter | Quantas vezes redaction foi aplicada em uma resposta |
| `lia.leak_blocked` | counter | Quantas vezes vazamento interno foi bloqueado |
| `lia.price_estimate_blocked` | counter | Quantas vezes estimativa de preço foi bloqueada por falta de tabela vigente |
| `lia.price_estimate_allowed` | counter | Quantas vezes estimativa foi permitida com preço válido |

---

## 5. Critérios de aceitação (CRIVO)

- [ ] **T1:** Funções `redactCPF()` e `redactRG()` cobrem CPF, RG, telefone, e-mail com ≥95% de precisão em teste unitário.
- [ ] **T2:** Função `detectarVazamentoInterno()` detecta UUIDs, tokens (`dsk_`, `eyJ`) e paths internos com 100% de recall.
- [ ] **T3:** Resposta da Lia com menção a preço sem tabela vigente retorna template de bloqueio, não valor inventado.
- [ ] **T4:** Métricas são emitidas e consultáveis via endpoint `/api/v1/metrics`.
- [ ] **T5:** Nenhum log de produção contém CPF/RG/telefone/em-e-mail em plaintext após 7 dias de operação (auditoria manual).

---

## 6. Notas de implementação

- **Ordem de execução:** redaction → leak guard → price check → deliver.
- **Performance:** funções de guardrail devem ter p99 ≤10ms; usar cache LRU de 100 entradas para compilação de regex.
- **Fallback:** se qualquer função de guardrail lançar exceção, bloquear a resposta e retornar erro 500 ao caller (melhor falhar seguro que vazar dado).