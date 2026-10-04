#!/usr/bin/env node
/**
 * Dublê HTTP local da fonte oficial CV CRM para a jornada E2E.
 * Escuta apenas em loopback e nunca toca internet.
 *
 * GET  /api/v1/records/:orgId -> snapshot sintético das quatro entidades
 * GET  /__duble/saude         -> estado do dublê
 * POST /__duble/cenario       -> { "cenario": "base" | "changed" | "stale" | "unavailable" }
 */
import http from "node:http";

const PORTA = Number(process.env.DUBLE_CV_CRM_PORTA ?? 3995);
const HOST = process.env.DUBLE_CV_CRM_HOST ?? "127.0.0.1";
let cenario = "base";
let chamadas = 0;

function responder(res, status, corpo) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corpo));
}

async function lerJson(req) {
  const partes = [];
  for await (const parte of req) partes.push(parte);
  const bruto = Buffer.concat(partes).toString("utf8");
  return bruto ? JSON.parse(bruto) : {};
}

function snapshot() {
  const changed = cenario === "changed";
  const valor = changed ? "27500000" : "25000000";
  const statusUnidade = changed ? "reservado" : "disponivel";

  const development = {
    entity_type: "development",
    external_id: "DEV-E2E",
    payload: {
      nome: "Residencial CV CRM E2E",
      constructor_nome: "EngenhArq E2E",
      status: "em_andamento",
    },
  };

  if (cenario === "stale") {
    return [
      development,
      {
        entity_type: "price_list",
        external_id: "PL-E2E",
        payload: {
          development_external_id: "DEV-E2E",
          nome: "Tabela Oficial E2E",
          vigencia_inicio: "2026-10-04",
          status: "ativa",
        },
      },
    ];
  }

  return [
    development,
    {
      entity_type: "unit",
      external_id: "UNIT-E2E",
      payload: {
        development_external_id: "DEV-E2E",
        numero: "101",
        bloco: "A",
        valor_cents: valor,
        status: statusUnidade,
      },
    },
    {
      entity_type: "price_list",
      external_id: "PL-E2E",
      payload: {
        development_external_id: "DEV-E2E",
        nome: "Tabela Oficial E2E",
        vigencia_inicio: "2026-10-04",
        status: "ativa",
      },
    },
    {
      entity_type: "price_list_item",
      external_id: "PLI-E2E",
      payload: {
        price_list_external_id: "PL-E2E",
        unit_external_id: "UNIT-E2E",
        valor_cents: valor,
        status: statusUnidade,
        unidade_ref: "A-101",
      },
    },
  ];
}

const servidor = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${HOST}:${PORTA}`);

    if (req.method === "GET" && url.pathname === "/__duble/saude") {
      return responder(res, 200, { ok: true, porta: PORTA, cenario, chamadas });
    }

    if (req.method === "POST" && url.pathname === "/__duble/cenario") {
      const body = await lerJson(req);
      const proximo = body?.cenario;
      if (!new Set(["base", "changed", "stale", "unavailable"]).has(proximo)) {
        return responder(res, 400, { error: "cenario_invalido" });
      }
      cenario = proximo;
      return responder(res, 200, { ok: true, cenario });
    }

    if (req.method === "GET" && /^\/api\/v1\/records\/[^/]+$/.test(url.pathname)) {
      chamadas += 1;
      if (cenario === "unavailable") {
        return responder(res, 503, { error: "fonte_indisponivel_sintetica" });
      }
      return responder(res, 200, snapshot());
    }

    return responder(res, 404, { error: "rota_desconhecida", path: url.pathname });
  } catch (erro) {
    console.error("[duble-cv-crm] falha:", erro);
    return responder(res, 500, { error: "duble_falhou" });
  }
});

servidor.listen(PORTA, HOST, () => {
  console.info(`[duble-cv-crm] ouvindo em http://${HOST}:${PORTA}`);
});

for (const sinal of ["SIGINT", "SIGTERM"]) {
  process.on(sinal, () => process.exit(0));
}