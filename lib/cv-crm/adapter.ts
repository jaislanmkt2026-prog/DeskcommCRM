export const CV_CRM_ENTITY_TYPES = [
  "development",
  "unit",
  "price_list",
  "price_list_item",
] as const;

export type CvCrmEntityType = (typeof CV_CRM_ENTITY_TYPES)[number];

export interface CvCrmRecord {
  entity_type: CvCrmEntityType;
  external_id: string;
  payload: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function pickAliased(
  source: Record<string, unknown>,
  canonical: string,
  aliases: string[] = [],
): unknown {
  const names = [canonical, ...aliases];
  const present = names
    .filter((name) => Object.prototype.hasOwnProperty.call(source, name))
    .map((name) => ({ name, value: source[name] }));

  if (present.length === 0) return undefined;

  const first = present[0]!;
  for (const candidate of present.slice(1)) {
    if (!sameValue(first.value, candidate.value)) {
      throw new Error(
        `CV CRM payload conflict for ${canonical}: ${first.name} and ${candidate.name} disagree`,
      );
    }
  }

  return first.value;
}

function copyField(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  canonical: string,
  aliases: string[] = [],
): void {
  const value = pickAliased(source, canonical, aliases);
  if (value !== undefined) target[canonical] = value;
}

function normalizePayload(
  entityType: CvCrmEntityType,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  switch (entityType) {
    case "development":
      copyField(payload, source, "nome", ["name"]);
      copyField(payload, source, "constructor_nome", ["constructor_name", "constructorName"]);
      copyField(payload, source, "localizacao", ["location"]);
      copyField(payload, source, "bairro", ["neighborhood"]);
      copyField(payload, source, "cidade", ["city"]);
      copyField(payload, source, "descricao", ["description"]);
      copyField(payload, source, "diferenciais", ["features"]);
      copyField(payload, source, "fotos", ["photos"]);
      copyField(payload, source, "documentos", ["documents"]);
      copyField(payload, source, "status");
      break;
    case "unit":
      copyField(payload, source, "development_external_id", ["developmentExternalId"]);
      copyField(payload, source, "bloco", ["block"]);
      copyField(payload, source, "numero", ["number"]);
      copyField(payload, source, "andar", ["floor"]);
      copyField(payload, source, "metragem", ["area", "square_meters", "squareMeters"]);
      copyField(payload, source, "quartos", ["bedrooms"]);
      copyField(payload, source, "suites");
      copyField(payload, source, "vagas", ["parking_spaces", "parkingSpaces"]);
      copyField(payload, source, "valor_cents", ["value_cents", "valueCents"]);
      copyField(payload, source, "condicoes", ["conditions"]);
      copyField(payload, source, "status");
      break;
    case "price_list":
      copyField(payload, source, "development_external_id", ["developmentExternalId"]);
      copyField(payload, source, "nome", ["name"]);
      copyField(payload, source, "etapa", ["stage"]);
      copyField(payload, source, "versao", ["version"]);
      copyField(payload, source, "vigencia_inicio", ["valid_from", "validFrom"]);
      copyField(payload, source, "vigencia_fim", ["valid_to", "validTo"]);
      copyField(payload, source, "origem_ref", ["source_ref", "sourceRef"]);
      copyField(payload, source, "status");
      break;
    case "price_list_item":
      copyField(payload, source, "price_list_external_id", ["priceListExternalId"]);
      copyField(payload, source, "unit_external_id", ["unitExternalId"]);
      copyField(payload, source, "valor_cents", ["value_cents", "valueCents"]);
      copyField(payload, source, "sinal_cents", ["down_payment_cents", "downPaymentCents"]);
      copyField(payload, source, "parcelas", ["installments"]);
      copyField(payload, source, "financiamento", ["financing"]);
      copyField(payload, source, "condicoes_chaves", ["key_conditions", "keyConditions"]);
      copyField(payload, source, "status");
      copyField(payload, source, "quadra");
      copyField(payload, source, "unidade_ref", ["unit_ref", "unitRef"]);
      copyField(payload, source, "observacoes", ["notes"]);
      break;
  }
  return payload;
}

export function normalizeCvCrmRecord(value: unknown): CvCrmRecord {
  if (!isObject(value)) throw new Error("CV CRM record must be an object");
  const entityTypeRaw = pickAliased(value, "entity_type", ["entityType"]);
  if (
    typeof entityTypeRaw !== "string" ||
    !CV_CRM_ENTITY_TYPES.includes(entityTypeRaw as CvCrmEntityType)
  ) {
    throw new Error(`CV CRM record has unsupported entity_type: ${String(entityTypeRaw)}`);
  }
  const entityType = entityTypeRaw as CvCrmEntityType;
  const externalIdRaw = pickAliased(value, "external_id", ["externalId"]);
  if (typeof externalIdRaw !== "string" || externalIdRaw.trim().length === 0) {
    throw new Error("CV CRM record external_id must be a non-empty string");
  }
  if (!isObject(value.payload)) {
    throw new Error(`CV CRM record ${externalIdRaw.trim()} payload must be an object`);
  }
  return {
    entity_type: entityType,
    external_id: externalIdRaw.trim(),
    payload: normalizePayload(entityType, value.payload),
  };
}

async function fetchReal(orgId: string, since?: Date): Promise<CvCrmRecord[]> {
  const baseUrl = process.env.CV_CRM_API_URL;
  if (!baseUrl) throw new Error("CV_CRM_API_URL not configured");
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const url = new URL(`api/v1/records/${encodeURIComponent(orgId)}`, normalizedBase);
  if (since) url.searchParams.set("since", since.toISOString());
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
    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new Error("CV CRM API returned invalid format: expected an array");
    }
    return data.map((record, index) => {
      try {
        return normalizeCvCrmRecord(record);
      } catch (error) {
        throw new Error(
          `CV CRM API record at index ${index} is invalid: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("CV CRM API request timed out after 30s");
    }
    if (err instanceof TypeError && err.message.toLowerCase().includes("fetch")) {
      throw new Error(`CV CRM API unavailable: ${String(err)}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBatch(orgId: string, since?: Date): Promise<CvCrmRecord[]> {
  return fetchReal(orgId, since);
}
