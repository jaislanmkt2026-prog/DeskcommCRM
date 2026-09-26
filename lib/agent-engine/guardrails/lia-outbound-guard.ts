import { redactSensitive } from "./redact-pii";
import { detectarVazamentoInterno } from "./vazamento-interno";

export const LIA_PRICE_FAILSAFE =
  "O valor dessa unidade está sendo atualizado. Vou deixar essa confirmação com o corretor responsável para te passar a informação oficial.";

export interface ToolReceipt {
  toolName: string;
  ok: boolean;
  data?: {
    price?: {
      valor_cents?: number | null;
    };
  };
}

export interface OutboundGuardOptions {
  actorType?: string;
  isAiAgent?: boolean;
  toolReceipts?: ToolReceipt[];
}

export interface OutboundGuardResult {
  body: string;
  sanitized: boolean;
  priceGateTriggered: boolean;
  priceGatePassed: boolean;
  blocked: boolean;
  blockReason?: string;
}

/**
 * Remove menções legítimas de dados do cliente (renda, orçamento informado, entrada disponível)
 * para que a análise de preço de imóvel recaia apenas sobre afirmações de preço do imóvel.
 */
function removerValoresDoCliente(text: string): string {
  let cleaned = text;

  // Renda do cliente: "minha renda é R$ 8.500", "renda de R$ 8.500", "renda informada: 8500", etc.
  cleaned = cleaned.replace(
    /(?:minha\s+)?renda\s*(?:mensal|declarada|informada)?\s*(?:é|de|foi|seria|em|:)?\s*(?:de\s+)?R?\$?\s*[\d\.,]+(?:\s*(?:reais|mil))?/gi,
    "[DADO_CLIENTE_RENDA]"
  );

  // Orçamento do cliente: "posso comprar até R$ 500 mil", "orçamento de até 500 mil", "faixa de até R$ 500.000", "teto de 500 mil"
  cleaned = cleaned.replace(
    /(?:posso\s+(?:comprar|investir|pagar|gastar)\s+(?:até\s+)?|orçamento\s*(?:de|até|é|:)?\s*(?:de\s+)?|faixa\s*(?:de\s+valor)?\s*(?:de|até|é)?\s*|teto\s*(?:de|até)?\s*|limite\s*(?:de|até)?\s*|até\s+)R?\$?\s*[\d\.,]+(?:\s*(?:mil(?:hões)?|reais))?/gi,
    "[DADO_CLIENTE_ORCAMENTO]"
  );

  // Entrada disponível do cliente: "tenho R$ 50 mil para entrada", "você tem R$ 50 mil para entrada", "R$ 50 mil de entrada"
  cleaned = cleaned.replace(
    /(?:(?:você\s+)?tem\s+(?:de\s+)?|tenho\s+(?:de\s+)?|disponho\s+de\s+|minha\s+entrada\s*(?:é|de)?\s*|entrada\s*(?:disponível)?\s*(?:é|de)?\s*)R?\$?\s*[\d\.,]+(?:\s*(?:mil(?:hões)?|reais))?(?:\s*(?:de\s+entrada|para\s+entrada))?/gi,
    "[DADO_CLIENTE_ENTRADA]"
  );
  cleaned = cleaned.replace(
    /R?\$?\s*[\d\.,]+(?:\s*(?:mil(?:hões)?|reais))?\s*(?:de\s+entrada|para\s+entrada)/gi,
    "[DADO_CLIENTE_ENTRADA]"
  );

  return cleaned;
}

/**
 * Detecta se o texto contém afirmação explícita de preço de imóvel ou condição comercial
 * que exija comprovação oficial via receipt de crm_get_unit_price.
 */
export function detectarAfirmacaoPrecoImovel(text: string): {
  temPrecoImovel: boolean;
  trechosDetectados: string[];
} {
  // Limpa menções a dados do cliente para evitar falso positivo
  const textoParaAnalise = removerValoresDoCliente(text);

  // Padrões de afirmação de preço do imóvel:
  // 1. "O valor da unidade é R$ 450.000", "preço de R$ 400 mil", "custa R$ 350.000", "sai por R$ 500 mil"
  const regexPrecoDireto =
    /(?:valor|preço|custa|custando|sai\s+por|saindo\s+por|tabela\s+de|por\s+apenas|no\s+valor\s+de)\s*(?:é|de|está|fica|seria)?\s*(?:R\$\s*[\d\.]+(?:,\d{2})?|[\d\.]+\s*(?:mil(?:hões)?|reais))/gi;

  // 2. Unidade/apto associado a valor: "unidade 101 por R$ 300.000", "ap 201 por 400 mil"
  const regexUnidadeValor =
    /(?:unidade|apto|apartamento|imóvel|lote|casa)\s*[\w\d-]*\s*(?:por|no\s+valor\s+de|sai\s+por)\s*R?\$?\s*[\d\.]+(?:\s*(?:mil(?:hões)?|reais))?/gi;

  // 3. Condições de parcelas/sinal inventadas: "sinal de R$ 50.000 e 60 parcelas de R$ 1.500"
  const regexCondicoes =
    /(?:sinal\s*(?:de)?\s*R\$\s*[\d\.]+|\b\d+\s*parcelas?\s*de\s*R\$\s*[\d\.]+)/gi;

  // 4. Qualquer menção isolada a R$ XXX.XXX ou XXX mil que sobrou após remoção dos dados do cliente
  const regexValorResidual =
    /(?:R\$\s*\d{1,3}(?:\.\d{3})+(?:,\d{2})?|R\$\s*\d+(?:,\d{2})?|\b\d{2,3}\s*mil\s*(?:reais)?\b)/gi;

  const trechos: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = regexPrecoDireto.exec(textoParaAnalise)) !== null) {
    trechos.push(match[0]);
  }
  while ((match = regexUnidadeValor.exec(textoParaAnalise)) !== null) {
    trechos.push(match[0]);
  }
  while ((match = regexCondicoes.exec(textoParaAnalise)) !== null) {
    trechos.push(match[0]);
  }
  while ((match = regexValorResidual.exec(textoParaAnalise)) !== null) {
    trechos.push(match[0]);
  }

  const trechosUnicos = Array.from(new Set(trechos));
  return {
    temPrecoImovel: trechosUnicos.length > 0,
    trechosDetectados: trechosUnicos,
  };
}

/**
 * Aplica os guardrails de saída para mensagens da IA (Lia).
 *
 * Garante que:
 * 1. PII (CPF, RG, telefone, e-mail) seja redigido via redactSensitive.
 * 2. Vazamento de vocabulário interno seja bloqueado via detectarVazamentoInterno.
 * 3. Afirmações de preço de imóvel sem receipt oficial da tool crm_get_unit_price
 *    sejam substituídas pelo fail-safe determinístico oficial.
 * 4. Dados legítimos do cliente (renda, orçamento, entrada informada) NÃO sejam bloqueados.
 */
export function aplicarGuardrailLiaOutbound(
  body: string,
  options: OutboundGuardOptions = {}
): OutboundGuardResult {
  // Se for mensagem de usuário humano (Jaislan/corretor), não altera nada
  if (options.actorType === "user" || options.isAiAgent === false) {
    return {
      body,
      sanitized: false,
      priceGateTriggered: false,
      priceGatePassed: true,
      blocked: false,
    };
  }

  // 1. Redaction de PII
  const bodyRedacted = redactSensitive(body);

  // 2. Detecção de Vazamento Interno (tools internas, UUIDs internos, tabelas, webhooks)
  const vazamento = detectarVazamentoInterno(bodyRedacted);
  if (vazamento.achou) {
    return {
      body: bodyRedacted,
      sanitized: true,
      priceGateTriggered: false,
      priceGatePassed: false,
      blocked: true,
      blockReason: `lia_guardrail_vazamento_interno: ${vazamento.categorias.join(",")}`,
    };
  }

  // 3. Gate Determinístico de Preço de Imóvel
  const { temPrecoImovel } = detectarAfirmacaoPrecoImovel(bodyRedacted);

  if (!temPrecoImovel) {
    // Sem menção a preço de imóvel -> Passa direto
    return {
      body: bodyRedacted,
      sanitized: bodyRedacted !== body,
      priceGateTriggered: false,
      priceGatePassed: true,
      blocked: false,
    };
  }

  // Se detectou afirmação de preço de imóvel, verifica se há receipt oficial válido
  const priceReceipt = options.toolReceipts?.find(
    (r) => r.toolName === "crm_get_unit_price" && r.ok === true
  );

  if (priceReceipt && priceReceipt.data?.price?.valor_cents) {
    // Tem receipt oficial comprovado
    return {
      body: bodyRedacted,
      sanitized: bodyRedacted !== body,
      priceGateTriggered: true,
      priceGatePassed: true,
      blocked: false,
    };
  }

  // Sem receipt oficial comprovado de preço -> Aplica o FAIL-SAFE determinístico
  // Substitui afirmações inventadas pelo fail-safe oficial de consulta ao corretor
  let bodyComFailSafe = bodyRedacted;

  // Se a mensagem inteira era uma resposta direta sobre preço, substitui pelo fail-safe completo
  const pareceRespostaExclusivaDePreco =
    bodyRedacted.length < 250 &&
    (bodyRedacted.toLowerCase().includes("valor") ||
      bodyRedacted.toLowerCase().includes("preço") ||
      bodyRedacted.toLowerCase().includes("custa") ||
      bodyRedacted.toLowerCase().includes("r$"));

  if (pareceRespostaExclusivaDePreco) {
    bodyComFailSafe = LIA_PRICE_FAILSAFE;
  } else {
    // Substitui a frase ou trecho de preço pelo fail-safe
    bodyComFailSafe = `${LIA_PRICE_FAILSAFE}\n\n${bodyRedacted}`;
  }

  return {
    body: bodyComFailSafe,
    sanitized: true,
    priceGateTriggered: true,
    priceGatePassed: false,
    blocked: false, // Não bloqueia o envio com erro de rede, entrega o fail-safe seguro!
  };
}
