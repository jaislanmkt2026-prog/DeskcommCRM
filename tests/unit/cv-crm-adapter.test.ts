import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchBatch, normalizeCvCrmRecord } from "@/lib/cv-crm/adapter";

describe("CV CRM adapter", () => {
  const originalApiUrl = process.env.CV_CRM_API_URL;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.CV_CRM_API_URL = "https://cv-crm.example.test/base";
  });

  afterEach(() => {
    if (originalApiUrl === undefined) {
      delete process.env.CV_CRM_API_URL;
    } else {
      process.env.CV_CRM_API_URL = originalApiUrl;
    }
    vi.unstubAllGlobals();
  });

  it("normaliza aliases para o contrato canonico sem inventar campos", () => {
    expect(
      normalizeCvCrmRecord({
        entityType: "price_list_item",
        externalId: " PLI-1 ",
        payload: {
          priceListExternalId: "PL-1",
          unitExternalId: "UNIT-1",
          valueCents: 123_000,
          status: "disponivel",
        },
      }),
    ).toEqual({
      entity_type: "price_list_item",
      external_id: "PLI-1",
      payload: {
        price_list_external_id: "PL-1",
        unit_external_id: "UNIT-1",
        valor_cents: 123_000,
        status: "disponivel",
      },
    });
  });

  it("recusa aliases conflitantes em vez de escolher um silenciosamente", () => {
    expect(() =>
      normalizeCvCrmRecord({
        entity_type: "unit",
        external_id: "UNIT-1",
        payload: {
          numero: "101",
          number: "102",
        },
      }),
    ).toThrow(/payload conflict for numero/i);
  });

  it("fetchBatch sem since consulta snapshot completo e valida a resposta", async () => {
    const fetchMock = vi.fn(async (_input: string | URL) => ({
      ok: true,
      json: async () => [
        {
          entity_type: "development",
          external_id: "DEV-1",
          payload: {
            name: "Residencial Oficial",
            constructor_name: "Construtora Oficial",
            status: "em_andamento",
          },
        },
      ],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchBatch("org com espaco");

    expect(result).toHaveLength(1);
    expect(result[0]?.payload).toMatchObject({
      nome: "Residencial Oficial",
      constructor_nome: "Construtora Oficial",
    });

    const calledUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(calledUrl.pathname).toBe("/base/api/v1/records/org%20com%20espaco");
    expect(calledUrl.searchParams.has("since")).toBe(false);
  });

  it("recusa formato de fonte invalido", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ records: [] }),
      })),
    );

    await expect(fetchBatch("org-1")).rejects.toThrow(/expected an array/i);
  });

  it("falha fechada quando a fonte esta indisponivel", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("fetch failed"))));

    await expect(fetchBatch("org-1")).rejects.toThrow(/CV CRM API unavailable/i);
  });
});
