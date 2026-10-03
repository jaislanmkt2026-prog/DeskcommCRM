export interface CvCrmRecord {
  entity_type: "development" | "unit" | "price_list" | "price_list_item";
  external_id: string;
  payload: Record<string, unknown>;
}

const MOCK_DATA: CvCrmRecord[] = [
  {
    entity_type: "development",
    external_id: "dev-001",
    payload: { name: "Residencial Alpha", status: "active" },
  },
  {
    entity_type: "development",
    external_id: "dev-002",
    payload: { name: "Residencial Beta", status: "planning" },
  },
  {
    entity_type: "unit",
    external_id: "unit-101",
    payload: { development_id: "dev-001", number: "101", floor: 1 },
  },
  {
    entity_type: "unit",
    external_id: "unit-102",
    payload: { development_id: "dev-001", number: "102", floor: 1 },
  },
  {
    entity_type: "price_list",
    external_id: "pl-2024",
    payload: { name: "Tabela 2024 Q4", valid_from: "2024-10-01" },
  },
  {
    entity_type: "price_list_item",
    external_id: "pli-001",
    payload: { price_list_id: "pl-2024", unit_id: "unit-101", price: 450000 },
  },
  {
    entity_type: "price_list_item",
    external_id: "pli-002",
    payload: { price_list_id: "pl-2024", unit_id: "unit-102", price: 470000 },
  },
];

async function fetchMock(): Promise<CvCrmRecord[]> {
  return MOCK_DATA;
}

async function fetchReal(orgId: string, since?: Date): Promise<CvCrmRecord[]> {
  const baseUrl = process.env.CV_CRM_API_URL;
  if (!baseUrl) {
    throw new Error("CV_CRM_API_URL not configured");
  }

  const url = new URL(`${baseUrl}/api/v1/records/${orgId}`);
  if (since) {
    url.searchParams.set("since", since.toISOString());
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      throw new Error(`CV CRM API returned ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("CV CRM API returned invalid format");
    }

    return data as CvCrmRecord[];
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("CV CRM API request timed out after 30s");
    }
    if (err instanceof TypeError && err.message.includes("fetch")) {
      throw new Error(`CV CRM API unavailable: ${String(err)}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBatch(orgId: string, since?: Date): Promise<CvCrmRecord[]> {
  if (process.env.CV_CRM_MOCK === "true") {
    return fetchMock();
  }
  return fetchReal(orgId, since);
}
