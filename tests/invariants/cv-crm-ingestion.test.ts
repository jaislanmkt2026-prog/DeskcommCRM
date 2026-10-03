import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ORG,
  columnExists,
  countAs,
  indexExists,
  seedGov,
  sql,
  tableExists,
  writeCountAs,
} from "./gov-helpers";

const ORG_B = "dddddddd-0000-4000-8000-000000000082";
const BATCH_A = "dddddddd-3000-4000-8000-000000000081";
const BATCH_B = "dddddddd-3000-4000-8000-000000000082";
const DEV_A = "dddddddd-2000-4000-8000-000000000081";
const DEV_B = "dddddddd-2000-4000-8000-000000000082";
const UNIT_A = "dddddddd-2100-4000-8000-000000000081";
const PL_A = "dddddddd-2200-4000-8000-000000000081";
const PLI_A = "dddddddd-2300-4000-8000-000000000081";

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'cv-crm-b', 'CV CRM Org B', 'CV CRM B')
      on conflict do nothing;

    delete from public.cv_crm_staging
      where organization_id in ('${GOV_ORG}', '${ORG_B}')
        and batch_id in ('${BATCH_A}', '${BATCH_B}');
    delete from public.cv_crm_ingestion_logs
      where organization_id in ('${GOV_ORG}', '${ORG_B}')
        and batch_id in ('${BATCH_A}', '${BATCH_B}');
    delete from public.real_estate_price_list_items where organization_id in ('${GOV_ORG}', '${ORG_B}');
    delete from public.real_estate_price_lists where organization_id in ('${GOV_ORG}', '${ORG_B}');
    delete from public.real_estate_units where organization_id in ('${GOV_ORG}', '${ORG_B}');
    delete from public.real_estate_developments where organization_id in ('${GOV_ORG}', '${ORG_B}');

    insert into public.real_estate_developments (id, organization_id, nome, external_id, cv_crm_last_seen_at)
      values ('${DEV_A}', '${GOV_ORG}', 'Dev A', 'CV-DEV-A', now())
      on conflict do nothing;

    insert into public.cv_crm_staging
      (organization_id, batch_id, entity_type, external_id, raw_payload, validation_status)
      values
        ('${GOV_ORG}', '${BATCH_A}', 'development', 'CV-DEV-A', '{"nome":"Dev A Atualizado"}', 'valid'),
        ('${GOV_ORG}', '${BATCH_A}', 'unit', 'CV-UNIT-A', '{"numero":"101"}', 'valid'),
        ('${ORG_B}', '${BATCH_B}', 'development', 'CV-DEV-B', '{"nome":"Dev B"}', 'valid');

    insert into public.cv_crm_ingestion_logs
      (organization_id, batch_id, status, total_records)
      values
        ('${GOV_ORG}', '${BATCH_A}', 'completed', 2),
        ('${ORG_B}', '${BATCH_B}', 'completed', 1);
  `);
});

describe("cv-crm-ingestion — cenários A-F", () => {
  it("A: tabelas de staging e log existem", () => {
    expect(tableExists("cv_crm_staging")).toBe(true);
    expect(tableExists("cv_crm_ingestion_logs")).toBe(true);
  });

  it("B: validação rejeita valor_cents nao numerico", () => {
    const raw = sql(`
      select public.fn_validate_cv_crm_record(
        'price_list_item',
        '{"valor_cents":"abc","unit_id":"U-1"}'::jsonb
      );
    `);
    const result = JSON.parse(raw) as { valid: boolean; errors: string[] };
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toMatch(/valor_cents/);
  });

  it("C: idempotência — mesma chave externa não duplica no mesmo tenant", () => {
    expect(() =>
      sql(`
        insert into public.real_estate_developments
          (id, organization_id, nome, external_id)
        values
          ('${DEV_B}', '${GOV_ORG}', 'Dev B Duplicado', 'CV-DEV-A');
      `),
    ).toThrow(/duplicate key|uq_developments_org_external_id/i);
  });

  it("D: tenant isolation — org A não vê dados da org B", () => {
    const countA = countAs(
      GOV_ORG.substring(0, 36),
      `select count(*) from public.cv_crm_staging where batch_id = '${BATCH_A}';`,
    );
    expect(countA).toBeGreaterThanOrEqual(1);

    const crossOrgCount = sql(`
      select count(*) from public.cv_crm_staging
       where organization_id = '${GOV_ORG}'
         and external_id = 'CV-DEV-B';
    `);
    expect(crossOrgCount).toBe("0");
  });

  it("E: reconciliation — campos de timestamp existem", () => {
    expect(columnExists("real_estate_developments", "cv_crm_last_seen_at")).toBe(true);
    expect(columnExists("real_estate_developments", "cv_crm_stale_since")).toBe(true);
    expect(columnExists("real_estate_units", "cv_crm_last_seen_at")).toBe(true);
    expect(columnExists("real_estate_units", "cv_crm_stale_since")).toBe(true);
  });

  it("F: RLS write — authenticated não escreve staging diretamente", () => {
    const wrote = writeCountAs(
      GOV_ORG.substring(0, 36),
      `insert into public.cv_crm_staging
        (organization_id, batch_id, entity_type, external_id, raw_payload)
       values
        ('${GOV_ORG}', '${BATCH_A}', 'unit', 'WRITE-PROBE', '{}')`,
    );
    expect(wrote).toBe(0);
  });

  it("indices unicos tenant-scoped existem", () => {
    expect(indexExists("uq_developments_org_external_id")).toBe(true);
    expect(indexExists("uq_units_org_external_id")).toBe(true);
    expect(indexExists("uq_price_lists_org_external_id")).toBe(true);
    expect(indexExists("uq_price_list_items_org_external_id")).toBe(true);
  });

  it("FKs de organization_id nas tabelas de staging e log", () => {
    const out = sql(`
      select count(*) from pg_constraint
       where conname in (
         'cv_crm_staging_organization_id_fkey',
         'cv_crm_ingestion_logs_organization_id_fkey'
       )
         and contype = 'f';
    `);
    expect(out).toBe("2");
  });
});
