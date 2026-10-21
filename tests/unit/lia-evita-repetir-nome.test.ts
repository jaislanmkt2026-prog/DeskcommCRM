import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LIA_CONVERSATION_SYSTEM_BLOCK,
  mensagemMencionaNomeDoCliente,
  validarRepeticaoDoNomeDaLia,
} from '@/lib/agent-engine/guardrails/lia-conversation-policy';

const LIA = ['crm_get_unit_price', 'crm_request_handoff_imobiliario'];

describe('Lia - evita repetir o nome do cliente', () => {
  it('permite a primeira mencao do nome quando nao houve uso recente', () => {
    expect(
      validarRepeticaoDoNomeDaLia({
        body: 'Joao, consigo verificar isso para voce.',
        contactName: 'João da Silva',
        historicoOutbound: ['Certo, vou consultar a unidade.'],
        toolIds: LIA,
      }),
    ).toEqual({ ok: true });
  });

  it('bloqueia nova mencao quando o nome apareceu nas ultimas respostas', () => {
    expect(
      validarRepeticaoDoNomeDaLia({
        body: 'JOAO, qual faixa de valor voce busca?',
        contactName: 'João da Silva',
        historicoOutbound: ['João, encontrei a unidade que você pediu.', 'Ela segue disponível.'],
        toolIds: LIA,
      }),
    ).toMatchObject({ ok: false, code: 'lia_nome_repetido_recente' });
  });

  it('libera novamente quando o uso do nome ficou fora da janela recente', () => {
    expect(
      validarRepeticaoDoNomeDaLia({
        body: 'Maria, posso te passar a próxima informação?',
        contactName: 'Maria Clara',
        historicoOutbound: [
          'Maria, encontrei o cadastro.',
          'A unidade tem a informação atualizada.',
          'Vou seguir com a consulta.',
          'O valor veio da fonte oficial.',
          'Posso continuar por aqui.',
        ],
        toolIds: LIA,
        janelaRecente: 3,
      }),
    ).toEqual({ ok: true });
  });

  it('normaliza acentos e evita falso positivo por substring', () => {
    expect(mensagemMencionaNomeDoCliente('Oi, Jose! Tudo certo?', 'José Almeida')).toBe(true);
    expect(mensagemMencionaNomeDoCliente('Esse projeto ajusta o valor.', 'Jo')).toBe(false);
    expect(mensagemMencionaNomeDoCliente('A banana está cadastrada.', 'Ana')).toBe(false);
  });

  it('ignora nomes genericos de cadastro e nao altera outros agentes', () => {
    expect(mensagemMencionaNomeDoCliente('Cliente, vou verificar.', 'Cliente')).toBe(false);
    expect(
      validarRepeticaoDoNomeDaLia({
        body: 'João, sigo daqui.',
        contactName: 'João',
        historicoOutbound: ['João, mensagem anterior.'],
        toolIds: ['crm_search_contacts'],
      }),
    ).toEqual({ ok: true });
  });

  it('orienta o modelo e esta conectado ao send_message real', () => {
    expect(LIA_CONVERSATION_SYSTEM_BLOCK).toContain('Não repita o nome');

    const source = readFileSync(
      resolve(process.cwd(), 'lib/agent-engine/agent/inbound-turn.ts'),
      'utf8',
    );
    const inicio = source.indexOf('send_message: tool({');
    const fim = source.indexOf('search_knowledge: tool({', inicio);
    const bloco = fim > inicio ? source.slice(inicio, fim) : source.slice(inicio, inicio + 15000);

    expect(inicio).toBeGreaterThanOrEqual(0);
    expect(bloco).toContain('validarRepeticaoDoNomeDaLia({');
    expect(bloco).toContain('contactName: effectiveContext.contact.name');
    expect(bloco).toContain('...corposEnviados');
  });
});
