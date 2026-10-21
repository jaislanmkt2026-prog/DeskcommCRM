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

export async function fetchMock(): Promise<CvCrmRecord[]> {
  return MOCK_DATA;
}
