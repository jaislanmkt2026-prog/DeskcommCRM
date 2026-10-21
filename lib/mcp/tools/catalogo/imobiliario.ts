/**
 * Catálogo estático das tools imobiliárias.
 * Client-safe: sem zod, supabase ou next/headers.
 */
import { declararTools } from "./tipos";

export const TOOLS_IMOBILIARIO = declararTools([
  {
    name: "crm_list_developments",
    category: "read",
    rotulo: "Ver empreendimentos imobiliários",
    explicacao:
      "Mostra os condomínios e loteamentos cadastrados na organização para saber o que oferecer.",
    oQueToca: "Empreendimentos",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_get_development",
    category: "read",
    rotulo: "Ver ficha do condomínio",
    explicacao:
      "Abre a ficha completa de um condomínio ou loteamento com endereço e características.",
    oQueToca: "Empreendimentos",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_list_available_units",
    category: "read",
    rotulo: "Ver unidades disponíveis à venda",
    explicacao:
      "Lista os imóveis livres para negociação, excluindo o que já foi reservado ou vendido.",
    oQueToca: "Unidades",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_get_unit",
    category: "read",
    rotulo: "Ver detalhes de um imóvel",
    explicacao:
      "Consulta metragem, quartos, suítes, vagas de garagem e andar de uma unidade específica.",
    oQueToca: "Unidades",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_get_unit_price",
    category: "read",
    rotulo: "Ver tabela de preços da unidade",
    explicacao:
      "Consulta o valor oficial da tabela de preços ativa e condições de pagamento do imóvel.",
    oQueToca: "Tabela de preços",
    risco: "seguro",
    pacotes: ["vender"],
  },
  {
    name: "crm_save_lead_preferences",
    category: "write",
    rotulo: "Anotar preferências imobiliárias",
    explicacao:
      "Grava finalidade da compra, tipo de imóvel desejado, faixa de valor e quantidade de quartos.",
    oQueToca: "Perfil de interesse do comprador",
    risco: "atencao",
    pacotes: ["organizar"],
  },
  {
    name: "crm_save_attendance_summary",
    category: "write",
    rotulo: "Anotar resumo da conversa com comprador",
    explicacao:
      "Registra os principais pontos conversados com o comprador no histórico de atendimento.",
    oQueToca: "Histórico do cliente",
    risco: "atencao",
    pacotes: ["atender"],
  },
  {
    name: "crm_request_handoff_imobiliario",
    category: "write",
    rotulo: "Transferir comprador para corretor",
    explicacao:
      "Chama um corretor humano para assumir a conversa e entrega o resumo com as preferências.",
    oQueToca: "Fila de atendimento",
    risco: "atencao",
    pacotes: ["escalar"],
  },
  {
    name: "crm_get_document_checklist",
    category: "read",
    rotulo: "Ver lista de documentos exigidos",
    explicacao:
      "Consulta a lista de documentos necessários para a compra e a situação de envio de cada um.",
    oQueToca: "Documentos do comprador",
    risco: "seguro",
    pacotes: ["organizar"],
  },
  {
    name: "crm_update_document_checklist_item",
    category: "write",
    rotulo: "Atualizar situação de um documento",
    explicacao:
      "Marca um documento exigido como recebido ou pendente e associa à mensagem enviada pelo cliente.",
    oQueToca: "Documentos do comprador",
    risco: "atencao",
    pacotes: ["organizar"],
  },
]);
