import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  contarPerguntasExplicitas,
  isPreAtendimentoImobiliario,
  validarUmaPerguntaPorMensagemDaLia,
} from '@/lib/agent-engine/guardrails/lia-conversation-policy';

const LIA = ['crm_get_unit_price', 'crm_request_handoff_imobiliario'];

describe('Lia - uma pergunta por mensagem', () => {
  it('identifica o perfil de pre-atendimento imobiliario pela capability de handoff', () => {
    expect(isPreAtendimentoImobiliario(LIA)).toBe(true);
    expect(isPreAtendimentoImobiliario(['crm_get_unit_price'])).toBe(false);
  });

  it('bloqueia duas perguntas explicitas na mesma mensagem da Lia', () => {
    expect(
      validarUmaPerguntaPorMensagemDaLia({
        body: 'Qual empreendimento voce procura? E qual faixa de valor pretende investir?',
        toolIds: LIA,
      }),
    ).toMatchObject({ ok: false, code: 'lia_uma_pergunta_por_mensagem' });
  });

  it('permite zero ou uma pergunta e trata ?? como uma unica pergunta', () => {
    expect(validarUmaPerguntaPorMensagemDaLia({ body: 'Certo, vou verificar.', toolIds: LIA })).toEqual({
      ok: true,
    });
    expect(validarUmaPerguntaPorMensagemDaLia({ body: 'Tudo bem??', toolIds: LIA })).toEqual({
      ok: true,
    });
    expect(contarPerguntasExplicitas('Tudo bem??')).toBe(1);
  });

  it('nao conta query string de URL como pergunta ao lead', () => {
    expect(
      contarPerguntasExplicitas('Veja https://exemplo.com/imovel?unidade=12&origem=wa. Gostou?'),
    ).toBe(1);
  });

  it('nao altera outros agentes', () => {
    expect(
      validarUmaPerguntaPorMensagemDaLia({
        body: 'Pergunta um? Pergunta dois?',
        toolIds: ['crm_search_contacts'],
      }),
    ).toEqual({ ok: true });
  });

  it('esta conectado ao execute real de send_message', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'),
      'utf8',
    );
    const inicio = source.indexOf('send_message: tool({');
    const fim = source.indexOf('search_knowledge: tool({', inicio);
    const bloco = fim > inicio ? source.slice(inicio, fim) : source.slice(inicio, inicio + 12000);

    expect(inicio).toBeGreaterThanOrEqual(0);
    expect(bloco).toContain('validarUmaPerguntaPorMensagemDaLia({');
    expect(bloco).toContain('toolIds: agentConfig?.toolIds ?? []');
  });
});
