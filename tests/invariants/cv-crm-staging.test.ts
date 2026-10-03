import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
  tableExists,
} from "./gov-helpers";

const ORG_B = "dddddddd-0000-4000-8000-000000000091";
const VIEWER_B = "dddddddd-1111-4000-8000-000000000091";
const BATCH_SHARED = "dddddddd-3000-4000-8000-000000000091";
const BATCH_WRITE = "dddddddd-3000-4000-8000-000000000092";

function authenticatedCanInsert(userId: string, organizationId: string): boolean {
  try {
    sql(`
      set role authenticated;
      select set_config('request.jwt.claims', '{"sub":"${userId}"}', false);
      insert into public.cv_crm_staging
        (organization_id, batch_id, entity_type, external_id, raw_payload)
      values
        ('${organizationId}', '${BATCH_WRITE}', 'unit', 'WRITE-PROBE', '{}'::jsonb);
    `);
    return true;
  } catch {
    return false;
  }
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into auth.users (id, email)
      values ('${VIEWER_B}', 'cv-crm-viewer-b@invariant.test')
      on conflict do nothing;
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'cv-crm-staging-b', 'CV CRM Staging B', 'CV CRM Staging B')
      on conflict do nothing;

    insert into public.user_organizations
      (user_id, organization_id, role, accepted_at)
      values ('${VIEWER_B}', '${ORG_B}', 'viewer', now())
      on conflict do nothing;

    delete from public.cv_crm_staging
      where organization_id in ('${GOV_ORG}', '${ORG_B}')
        and batch_id in ('${BATCH_SHARED}', '${BATCH_WRITE}');
    delete from public.cv_crm_ingestion_logs
      where organization_id in ('${GOV_ORG}', '${ORG_B}')
        and batch_id = '${BATCH_SHARED}';

    insert into public.cv_crm_staging
      (organization_id, batch_id, entity_type, external_id, raw_payload, validation_status)
      values
        ('${GOV_ORG}', '${BATCH_SHARED}', 'unit', 'SHARED-001', '{"numero":"101"}', 'valid'),
        ('${ORG_B}', '${BATCH_SHARED}', 'unit', 'SHARED-001', '{"numero":"202"}', 'valid');

    insert into public.cv_crm_ingestion_logs
      (organization_id, batch_id, status, total_records)
      values
        ('${GOV_ORG}', '${BATCH_SHARED}', 'completed', 1),
        ('${ORG_B}', '${BATCH_SHARED}', 'completed', 1);
  `);
});

describe("0528 — staging CV CRM tenant-safe e server-only", () => {
  it("cria staging e log de ingestao", () => {
    expect(tableExists("cv_crm_staging")).toBe(true);
    expect(tableExists("cv_crm_ingestion_logs")).toBe(true);
  });

  it("viewer da org A enxerga somente a linha da org A", () => {
    expect(
      countAs(
        GOV_VIEWER,
        `select count(*) from public.cv_crm_staging where batch_id = '${BATCH_SHARED}';`,
      ),
    ).toBe(1);
  });

  it("viewer da org B enxerga somente a linha da org B", () => {
    expect(
      countAs(
        VIEWER_B,
        `select count(*) from public.cv_crm_staging where batch_id = '${BATCH_SHARED}';`,
      ),
    ).toBe(1);
  });

  it("o log de ingestao obedece ao mesmo isolamento", () => {
    expect(
      countAs(
        GOV_VIEWER,
        `select count(*) from public.cv_crm_ingestion_logs where batch_id = '${BATCH_SHARED}';`,
      ),
    ).toBe(1);
    expect(
      countAs(
        VIEWER_B,
        `select count(*) from public.cv_crm_ingestion_logs where batch_id = '${BATCH_SHARED}';`,
      ),
    ).toBe(1);
  });

  it("authenticated nao escreve staging diretamente", () => {
    expect(authenticatedCanInsert(GOV_VIEWER, GOV_ORG)).toBe(false);
  });

  it("a mesma chave de batch pode existir em tenants diferentes, mas nao duplicar no mesmo tenant", () => {
    expect(() =>
      sql(`
        insert into public.cv_crm_staging
          (organization_id, batch_id, entity_type, external_id, raw_payload)
        values
          ('${GOV_ORG}', '${BATCH_SHARED}', 'unit', 'SHARED-001', '{}'::jsonb);
      `),
    ).toThrow(/duplicate key|uq_cv_crm_staging_org_batch_entity_external/i);
  });
  it("validator e executavel somente por service_role", () => {
    const out = sql(`
      select
        has_function_privilege('anon', 'public.fn_validate_cv_crm_record(text,jsonb)', 'EXECUTE'),
        has_function_privilege('authenticated', 'public.fn_validate_cv_crm_record(text,jsonb)', 'EXECUTE'),
        has_function_privilege('service_role', 'public.fn_validate_cv_crm_record(text,jsonb)', 'EXECUTE');
    `);
    expect(out).toBe("f|f|t");
  });

  it("validator rejeita valor_cents nao numerico sem levantar excecao", () => {
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

  it("organization_id tem FK real para organizations nas duas tabelas", () => {
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
