export const LIA_PRE_ATENDIMENTO_MARKER_TOOL = 'crm_request_handoff_imobiliario';

export const LIA_UMA_PERGUNTA_POR_MENSAGEM_CODE = 'lia_uma_pergunta_por_mensagem';
export const LIA_NOME_REPETIDO_RECENTE_CODE = 'lia_nome_repetido_recente';

export const LIA_CONVERSATION_SYSTEM_BLOCK = `## Conversa da Lia
- Faça no máximo uma pergunta explícita por mensagem.
- Use o nome do cliente com parcimônia. Não repita o nome se ele já apareceu nas respostas recentes; prefira continuar a conversa naturalmente.`;

export function isPreAtendimentoImobiliario(toolIds: readonly string[] | null | undefined): boolean {
  return toolIds?.includes(LIA_PRE_ATENDIMENTO_MARKER_TOOL) ?? false;
}

function semUrls(texto: string): string {
  return texto.replace(/\b(?:https?:\/\/|www\.)\S+/gi, ' ');
}

function normalizarParaComparacao(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('pt-BR')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const TOKENS_DE_NOME_IGNORADOS = new Set([
  'cliente',
  'contato',
  'lead',
  'sr',
  'sra',
  'senhor',
  'senhora',
  'de',
  'da',
  'do',
  'das',
  'dos',
]);

function tokenPrincipalDoNome(nome: string | null | undefined): string | null {
  if (!nome) return null;
  const tokens = normalizarParaComparacao(nome).split(/\s+/).filter(Boolean);
  return tokens.find((token) => token.length >= 2 && !TOKENS_DE_NOME_IGNORADOS.has(token)) ?? null;
}

export function mensagemMencionaNomeDoCliente(
  body: string,
  contactName: string | null | undefined,
): boolean {
  const tokenDoNome = tokenPrincipalDoNome(contactName);
  if (tokenDoNome === null) return false;
  return normalizarParaComparacao(body).split(/\s+/).includes(tokenDoNome);
}

/**
 * Conta perguntas explicitas no corpo sem confundir query strings de URLs com
 * perguntas ao lead. Sequencias como "??" sao uma unica pergunta.
 */
export function contarPerguntasExplicitas(body: string): number {
  return semUrls(body).match(/\?+/g)?.length ?? 0;
}

export type LiaUmaPerguntaPolicyResult =
  | { ok: true }
  | { ok: false; code: typeof LIA_UMA_PERGUNTA_POR_MENSAGEM_CODE; message: string };

export function validarUmaPerguntaPorMensagemDaLia(input: {
  body: string;
  toolIds: readonly string[] | null | undefined;
}): LiaUmaPerguntaPolicyResult {
  if (!isPreAtendimentoImobiliario(input.toolIds)) return { ok: true };

  const quantidade = contarPerguntasExplicitas(input.body);
  if (quantidade <= 1) return { ok: true };

  return {
    ok: false,
    code: LIA_UMA_PERGUNTA_POR_MENSAGEM_CODE,
    message:
      'A Lia deve fazer uma pergunta por mensagem. Este texto contem ' +
      quantidade +
      ' perguntas. Escolha somente a proxima pergunta necessaria, envie-a e espere a resposta do lead.',
  };
}

export type LiaNomeRecentePolicyResult =
  | { ok: true }
  | { ok: false; code: typeof LIA_NOME_REPETIDO_RECENTE_CODE; message: string };

/**
 * Evita vocativo repetitivo sem proibir o nome para sempre: a primeira mencao
 * passa e uma nova mencao so e vetada quando o nome apareceu em uma das ultimas
 * respostas outbound. O historico do turno pode ser acrescentado pelo chamador.
 */
export function validarRepeticaoDoNomeDaLia(input: {
  body: string;
  contactName: string | null | undefined;
  historicoOutbound: readonly string[];
  toolIds: readonly string[] | null | undefined;
  janelaRecente?: number;
}): LiaNomeRecentePolicyResult {
  if (!isPreAtendimentoImobiliario(input.toolIds)) return { ok: true };
  if (!mensagemMencionaNomeDoCliente(input.body, input.contactName)) return { ok: true };

  const janela = Math.max(1, input.janelaRecente ?? 3);
  const houveMencaoRecente = input.historicoOutbound
    .filter((body) => body.trim() !== '')
    .slice(-janela)
    .some((body) => mensagemMencionaNomeDoCliente(body, input.contactName));

  if (!houveMencaoRecente) return { ok: true };

  return {
    ok: false,
    code: LIA_NOME_REPETIDO_RECENTE_CODE,
    message:
      'O nome do cliente ja apareceu nas respostas recentes. Reescreva esta mensagem sem repetir o nome e continue a conversa naturalmente.',
  };
}
