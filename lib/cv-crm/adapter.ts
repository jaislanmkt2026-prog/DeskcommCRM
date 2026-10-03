export interface CvCrmRecord {
  entity_type: "development" | "unit" | "price_list" | "price_list_item";
  external_id: string;
  payload: Record<string, unknown>;
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

// MOCK removido de produção - use apenas em testes unitários
export async function fetchBatch(orgId: string, since?: Date): Promise<CvCrmRecord[]> {
  return fetchReal(orgId, since);
}
