import { createClient } from "@supabase/supabase-js";
import { spawn, type ChildProcess } from "node:child_process";
import type { APIRequestContext } from "@playwright/test";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { expect, test } from "./helpers/test";

const DUBLE_URL = process.env.CV_CRM_API_URL ?? "http://127.0.0.1:3995";
const CRON_SECRET = process.env.INTERNAL_CRON_SECRET ?? process.env.INTERNAL_SECRET;
const ORG_ID = process.env.CV_CRM_ORG_ID;

if (!CRON_SECRET) throw new Error("INTERNAL_SECRET/INTERNAL_CRON_SECRET ausente no ambiente E2E");
if (!ORG_ID) throw new Error("CV_CRM_ORG_ID ausente no ambiente E2E");
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(DUBLE_URL)) {
  throw new Error(`CV_CRM_API_URL do E2E precisa ser loopback; recebido: ${DUBLE_URL}`);
}

const credenciais = credenciaisSupabaseDeTeste();
const admin = createClient(credenciais.url, credenciais.serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let duble: ChildProcess | null = null;
let dubleSaida = "";

async function esperarDuble(): Promise<void> {
  for (let tentativa = 0; tentativa < 50; tentativa += 1) {
    try {
      const res = await fetch(`${DUBLE_URL}/__duble/saude`);
      if (res.ok) return;
    } catch {
      // processo ainda subindo
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`dublê CV CRM não respondeu. Saída:\n${dubleSaida}`);
}

async function setScenario(cenario: "base" | "changed" | "stale" | "unavailable") {
  const res = await fetch(`${DUBLE_URL}/__duble/cenario`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cenario }),
  });
  expect(res.status).toBe(200);
}

async function triggerIngest(request: APIRequestContext) {
  return request.get("/api/v1/cron/cv-crm-ingest", {
    headers: { Authorization: `Bearer ${CRON_SECRET}` },
  });
}

async function esperarAudit(batchId: string, action: string): Promise<void> {
  for (let tentativa = 0; tentativa < 30; tentativa += 1) {
    const { data, error } = await admin
      .from("api_audit_log")
      .select("action,resource_id")
      .eq("resource_id", batchId)
      .eq("action", action)
      .limit(1);
    if (error) throw error;
    if ((data?.length ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`api_audit_log não recebeu ${action} para batch ${batchId}`);
}

test.describe.serial("CV CRM Ingestion Journey — fonte sintética local", () => {
  test.beforeAll(async () => {
    const processoDuble = spawn(process.execPath, ["scripts/duble-cv-crm-e2e.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, DUBLE_CV_CRM_PORTA: "3995", DUBLE_CV_CRM_HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    processoDuble.stdout.on("data", (chunk) => (dubleSaida += chunk.toString()));
    processoDuble.stderr.on("data", (chunk) => (dubleSaida += chunk.toString()));
    duble = processoDuble;
    await esperarDuble();
    await setScenario("base");
  });

  test.afterAll(() => {
    duble?.kill("SIGTERM");
  });

  test("G1: cron → adapter → staging → apply → consulta usa as quatro entidades", async ({ request }) => {
    const res = await triggerIngest(request);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", total_records: 4, valid: 4, invalid: 0, processed: 4 });

    const { data: unit, error: unitError } = await admin
      .from("real_estate_units")
      .select("external_id,numero,valor_cents,status,organization_id")
      .eq("organization_id", ORG_ID)
      .eq("external_id", "UNIT-E2E")
      .single();
    expect(unitError).toBeNull();
    expect(unit).toMatchObject({
      external_id: "UNIT-E2E",
      numero: "101",
      valor_cents: 25000000,
      status: "disponivel",
      organization_id: ORG_ID,
    });

    const { data: item, error: itemError } = await admin
      .from("real_estate_price_list_items")
      .select("external_id,valor_cents,status,organization_id")
      .eq("organization_id", ORG_ID)
      .eq("external_id", "PLI-E2E")
      .single();
    expect(itemError).toBeNull();
    expect(item).toMatchObject({ external_id: "PLI-E2E", valor_cents: 25000000, status: "disponivel" });

    await esperarAudit(body.batch_id, "cv_crm.ingestion_completed");
  });

  test("G2: rota rejeita chamada sem credencial interna", async ({ request }) => {
    const res = await request.get("/api/v1/cron/cv-crm-ingest");
    expect(res.status()).toBe(401);
  });

  test("G3: replay é idempotente e cria novo batch sem duplicar as entidades", async ({ request }) => {
    await setScenario("base");
    const first = await triggerIngest(request);
    expect(first.status()).toBe(200);
    const firstBody = await first.json();
    const second = await triggerIngest(request);
    expect(second.status()).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.batch_id).not.toBe(firstBody.batch_id);

    const { count, error } = await admin
      .from("real_estate_units")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", ORG_ID)
      .eq("external_id", "UNIT-E2E");
    expect(error).toBeNull();
    expect(count).toBe(1);
  });

  test("G4: alteração oficial de preço/disponibilidade reconcilia e deixa histórico", async ({ request }) => {
    await setScenario("changed");
    const res = await triggerIngest(request);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "ok", processed: 4 });

    const { data: unit, error } = await admin
      .from("real_estate_units")
      .select("id,valor_cents,status")
      .eq("organization_id", ORG_ID)
      .eq("external_id", "UNIT-E2E")
      .single();
    expect(error).toBeNull();
    expect(unit).toMatchObject({ valor_cents: 27500000, status: "reservado" });

    const { data: history, error: historyError } = await admin
      .from("real_estate_history")
      .select("campo,valor_anterior,valor_novo")
      .eq("organization_id", ORG_ID)
      .eq("unit_id", unit!.id)
      .eq("fonte", "cv_crm");
    expect(historyError).toBeNull();
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ campo: "valor_cents", valor_anterior: "25000000", valor_novo: "27500000" }),
        expect.objectContaining({ campo: "status", valor_anterior: "disponivel", valor_novo: "reservado" }),
      ]),
    );
  });

  test("G5: ausência após 24h marca unidade stale sem inventar disponibilidade", async ({ request }) => {
    const antigo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const { error: ageError } = await admin
      .from("real_estate_units")
      .update({ cv_crm_last_seen_at: antigo, cv_crm_stale_since: null })
      .eq("organization_id", ORG_ID)
      .eq("external_id", "UNIT-E2E");
    expect(ageError).toBeNull();

    await setScenario("stale");
    const res = await triggerIngest(request);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.stale_count).toBeGreaterThanOrEqual(1);

    const { data: unit, error } = await admin
      .from("real_estate_units")
      .select("cv_crm_stale_since,valor_cents,status")
      .eq("organization_id", ORG_ID)
      .eq("external_id", "UNIT-E2E")
      .single();
    expect(error).toBeNull();
    expect(unit!.cv_crm_stale_since).not.toBeNull();
    expect(unit).toMatchObject({ valor_cents: 27500000, status: "reservado" });
  });

  test("G6: fonte indisponível falha fechada e preserva último dado oficial", async ({ request }) => {
    await setScenario("unavailable");
    const res = await triggerIngest(request);
    expect(res.status()).toBe(500);
    const body = await res.json();
    expect(body.status).toBe("error");
    expect(body.processed).toBe(0);

    const { data: unit, error } = await admin
      .from("real_estate_units")
      .select("valor_cents,status,cv_crm_stale_since")
      .eq("organization_id", ORG_ID)
      .eq("external_id", "UNIT-E2E")
      .single();
    expect(error).toBeNull();
    expect(unit).toMatchObject({ valor_cents: 27500000, status: "reservado" });
    expect(unit!.cv_crm_stale_since).not.toBeNull();

    await esperarAudit(body.batch_id, "cv_crm.ingestion_failed");
  });
});