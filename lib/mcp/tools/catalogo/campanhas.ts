/**
 * Capacidades de CAMPANHA — disparo de uma mensagem para um público escolhido.
 *
 * ESTE ARQUIVO FALA COM O HUMANO que configura o agente — `rotulo`,
 * `explicacao` e `oQueToca`. O texto que vai ao MODELO é a `description` do
 * HANDLER (`lib/mcp/tools/campanhas.ts`).
 *
 * As três são `apenasHumano`: exigem o papel de gerente, acima do que o agente
 * publicado alcança (ver tests/unit/capacidade-alcancavel-pelo-agente.test.ts).
 * Quem as usa é um assistente de confiança do dono, nunca o atendimento ao cliente.
 */
import { declararTools } from "./tipos";

export const TOOLS_CAMPANHAS = declararTools([
  {
    name: "crm_list_campaigns",
    category: "read",
    rotulo: "Ver as campanhas de disparo",
    explicacao:
      "Mostra as campanhas da empresa com o estado de cada uma, quantas pessoas vão receber, quantas já receberam e o ritmo escolhido.",
    oQueToca: "Campanhas",
    risco: "seguro",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_create_campaign",
    category: "write",
    rotulo: "Criar campanha em rascunho",
    explicacao:
      "Monta uma campanha nova com o público, o texto e o ritmo de envio. Fica em rascunho: nada é enviado até alguém mandar começar.",
    oQueToca: "Campanhas",
    risco: "atencao",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
  {
    name: "crm_run_campaign_action",
    category: "write",
    rotulo: "Conduzir uma campanha",
    explicacao:
      "Prepara a lista, manda uma mensagem de teste, começa, agenda, pausa, retoma ou cancela uma campanha. Ao começar, as mensagens saem de verdade para os clientes.",
    oQueToca: "Campanhas",
    risco: "critico",
    pacotes: ["organizar"],
    apenasHumano: true,
  },
]);
