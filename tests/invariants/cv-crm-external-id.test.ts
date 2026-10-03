import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ORG,
  columnExists,
  indexExists,
  seedGov,
  sql,
} from "./gov-helpers";

const ORG_B = "dddddddd-0000-4000-8000-000000000081";
const CONSTRUCTOR_A = "dddddddd-1000-4000-8000-000000000081";
const CONSTRUCTOR_B = "dddddddd-1000-4000-8000-000000000082";
const DEV_A = "dddddddd-2000-4000-8000-000000000081";
const DEV_A_2 = "dddddddd-2000-4000-8000-000000000082";
const DEV_B = "dddddddd-2000-4000-8000-000000000083";

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'cv-crm-b', 'CV CRM B', 'CV CRM B')
      on conflict do nothing;

    insert into public.constructors (id, organization_id, nome, tipo_integracao, ativo)
      values
        ('${CONSTRUCTOR_A}', '${GOV_ORG}', 'CV Constructor A', 'api', true),
        ('${CONSTRUCTOR_B}', '${ORG_B}', 'CV Constructor B', 'api', true)
      on conflict (id) do nothing;
    insert into public.real_estate_developments
      (id, organization_id, constructor_id, nome, external_id)
      values
        ('${DEV_A}', '${GOV_ORG}', '${CONSTRUCTOR_A}', 'CV Dev A', null),
        ('${DEV_A_2}', '${GOV_ORG}', '${CONSTRUCTOR_A}', 'CV Dev A2', null),
        ('${DEV_B}', '${ORG_B}', '${CONSTRUCTOR_B}', 'CV Dev B', null)
      on conflict (id) do update set external_id = null;
  `);
});

describe("0527 — identidade CV CRM nas entidades imobiliarias", () => {
  it("external_id existe nas quatro entidades da Missao 8", () => {
    expect(columnExists("real_estate_developments", "external_id")).toBe(true);
    expect(columnExists("real_estate_units", "external_id")).toBe(true);
    expect(columnExists("real_estate_price_lists", "external_id")).toBe(true);
    expect(columnExists("real_estate_price_list_items", "external_id")).toBe(true);
  });

  it("developments e units carregam os timestamps de reconciliacao", () => {
    expect(columnExists("real_estate_developments", "cv_crm_last_seen_at")).toBe(true);
    expect(columnExists("real_estate_developments", "cv_crm_stale_since")).toBe(true);
    expect(columnExists("real_estate_units", "cv_crm_last_seen_at")).toBe(true);
    expect(columnExists("real_estate_units", "cv_crm_stale_since")).toBe(true);
  });

  it("a mesma identidade externa nao duplica dentro do mesmo tenant", () => {
    sql(`update public.real_estate_developments set external_id = 'CV-DUP' where id = '${DEV_A}';`);
    expect(() =>
      sql(`update public.real_estate_developments set external_id = 'CV-DUP' where id = '${DEV_A_2}';`),
    ).toThrow(/duplicate key|uq_developments_org_external_id/i);
  });

  it("a mesma identidade externa pode existir em tenants diferentes", () => {
    sql(`
      update public.real_estate_developments set external_id = 'CV-CROSS' where id = '${DEV_A}';
      update public.real_estate_developments set external_id = 'CV-CROSS' where id = '${DEV_B}';
    `);
    const out = sql(`
      select count(*) from public.real_estate_developments
       where external_id = 'CV-CROSS'
         and organization_id in ('${GOV_ORG}', '${ORG_B}');
    `);
    expect(out).toBe("2");
  });

  it("external_id vazio ou so com espacos e recusado", () => {
    expect(() =>
      sql(`update public.real_estate_developments set external_id = '   ' where id = '${DEV_A}';`),
    ).toThrow(/check constraint|chk_developments_external_id_not_blank/i);
  });

  it("os quatro indices unicos tenant-scoped existem", () => {
    expect(indexExists("uq_developments_org_external_id")).toBe(true);
    expect(indexExists("uq_units_org_external_id")).toBe(true);
    expect(indexExists("uq_price_lists_org_external_id")).toBe(true);
    expect(indexExists("uq_price_list_items_org_external_id")).toBe(true);
  });

  it("os indices legados globais da 0386 DEFERRED foram retirados", () => {
    expect(indexExists("idx_developments_external_id")).toBe(false);
    expect(indexExists("idx_units_external_id")).toBe(false);
  });
});
