import { beforeAll, describe, expect, it } from "vitest";

import { GOV_ORG, indexExists, lastLine, seedGov, sql } from "./gov-helpers";

const ORG_B = "dddddddd-0000-4000-8000-0000000000a2";
const BATCH_1 = "dddddddd-3000-4000-8000-0000000000a1";
const BATCH_2 = "dddddddd-3000-4000-8000-0000000000a2";
const BATCH_BAD = "dddddddd-3000-4000-8000-0000000000a3";
const BATCH_CROSS = "dddddddd-3000-4000-8000-0000000000a4";

function validate(entity: string, payload: Record<string, unknown>) {
  const raw = sql(`
    select public.fn_validate_cv_crm_record(
      '${entity}',
      '${JSON.stringify(payload).replaceAll("'", "''")}'::jsonb
    );
  `);
  return JSON.parse(lastLine(raw)) as { valid: boolean; errors: string[] };
}

function apply(orgId: string, batchId: string): number {
  const out = sql(`
    set role service_role;
    select public.fn_apply_cv_crm_valid_records('${orgId}', '${batchId}');
  `);
  return Number(lastLine(out));
}

beforeAll(() => {
  seedGov();
  sql(`
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG_B}', 'cv-crm-apply-b', 'CV CRM Apply B', 'CV CRM Apply B')
      on conflict do nothing;
  `);
});

describe("0529 — CV CRM apply atomico e fail-closed", () => {
  it("validator aceita o contrato canonico por external_id nas quatro entidades", () => {
    expect(
      validate("development", {
        nome: "Residencial Oficial",
        constructor_nome: "Construtora Oficial",
        status: "em_andamento",
      }).valid,
    ).toBe(true);

    expect(
      validate("unit", {
        development_external_id: "DEV-001",
        numero: "101",
        valor_cents: "25000000",
        status: "disponivel",
      }).valid,
    ).toBe(true);

    expect(
      validate("price_list", {
        development_external_id: "DEV-001",
        nome: "Tabela Outubro",
        vigencia_inicio: "2026-10-03",
        status: "ativa",
      }).valid,
    ).toBe(true);

    expect(
      validate("price_list_item", {
        price_list_external_id: "PL-001",
        unit_external_id: "UNIT-001",
        valor_cents: "25000000",
        status: "disponivel",
      }).valid,
    ).toBe(true);
  });

  it("validator recusa IDs internos, preco ausente e disponibilidade desconhecida", () => {
    const oldContract = validate("unit", {
      development_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      numero: "101",
      status: "disponivel",
    });
    expect(oldContract.valid).toBe(false);
    expect(oldContract.errors.join(" ")).toMatch(/development_external_id/);

    const missingPrice = validate("price_list_item", {
      price_list_external_id: "PL-001",
      unit_external_id: "UNIT-001",
      status: "disponivel",
    });
    expect(missingPrice.valid).toBe(false);
    expect(missingPrice.errors.join(" ")).toMatch(/valor_cents/);

    const unknownAvailability = validate("unit", {
      development_external_id: "DEV-001",
      numero: "101",
      status: "desconhecido",
    });
    expect(unknownAvailability.valid).toBe(false);
    expect(unknownAvailability.errors.join(" ")).toMatch(/disponibilidade invalido/);
  });

  it("aplica development -> unit -> price_list -> item e marca staging na mesma transacao", () => {
    sql(`
      delete from public.cv_crm_staging
       where organization_id = '${GOV_ORG}' and batch_id = '${BATCH_1}';

      insert into public.cv_crm_staging
        (organization_id, batch_id, entity_type, external_id, raw_payload, validation_status)
      values
        ('${GOV_ORG}', '${BATCH_1}', 'development', 'DEV-001',
          '{"nome":"Residencial Oficial","constructor_nome":"Construtora Oficial","status":"em_andamento"}', 'valid'),
        ('${GOV_ORG}', '${BATCH_1}', 'unit', 'UNIT-001',
          '{"development_external_id":"DEV-001","numero":"101","bloco":"A","valor_cents":"25000000","status":"disponivel"}', 'valid'),
        ('${GOV_ORG}', '${BATCH_1}', 'price_list', 'PL-001',
          '{"development_external_id":"DEV-001","nome":"Tabela Outubro","vigencia_inicio":"2026-10-03","status":"ativa"}', 'valid'),
        ('${GOV_ORG}', '${BATCH_1}', 'price_list_item', 'PLI-001',
          '{"price_list_external_id":"PL-001","unit_external_id":"UNIT-001","valor_cents":"25000000","status":"disponivel","unidade_ref":"A-101"}', 'valid');
    `);

    expect(apply(GOV_ORG, BATCH_1)).toBe(4);

    const counts = lastLine(
      sql(`
        select concat_ws('|',
          (select count(*) from public.real_estate_developments where organization_id='${GOV_ORG}' and external_id='DEV-001'),
          (select count(*) from public.real_estate_units where organization_id='${GOV_ORG}' and external_id='UNIT-001'),
          (select count(*) from public.real_estate_price_lists where organization_id='${GOV_ORG}' and external_id='PL-001'),
          (select count(*) from public.real_estate_price_list_items where organization_id='${GOV_ORG}' and external_id='PLI-001'),
          (select count(*) from public.cv_crm_staging where organization_id='${GOV_ORG}' and batch_id='${BATCH_1}' and validation_status='processed')
        );
      `),
    );
    expect(counts).toBe("1|1|1|1|4");
  });

  it("replay e idempotente e mudanca de preco/disponibilidade gera historico", () => {
    sql(`
      insert into public.cv_crm_staging
        (organization_id, batch_id, entity_type, external_id, raw_payload, validation_status)
      values
        ('${GOV_ORG}', '${BATCH_2}', 'development', 'DEV-001',
          '{"nome":"Residencial Oficial","constructor_nome":"Construtora Oficial","status":"em_andamento"}', 'valid'),
        ('${GOV_ORG}', '${BATCH_2}', 'unit', 'UNIT-001',
          '{"development_external_id":"DEV-001","numero":"101","bloco":"A","valor_cents":"27500000","status":"reservado"}', 'valid'),
        ('${GOV_ORG}', '${BATCH_2}', 'price_list', 'PL-001',
          '{"development_external_id":"DEV-001","nome":"Tabela Outubro","vigencia_inicio":"2026-10-03","status":"ativa"}', 'valid'),
        ('${GOV_ORG}', '${BATCH_2}', 'price_list_item', 'PLI-001',
          '{"price_list_external_id":"PL-001","unit_external_id":"UNIT-001","valor_cents":"27500000","status":"reservado","unidade_ref":"A-101"}', 'valid');
    `);

    expect(apply(GOV_ORG, BATCH_2)).toBe(4);

    const state = lastLine(
      sql(`
        select concat_ws('|',
          (select count(*) from public.real_estate_units where organization_id='${GOV_ORG}' and external_id='UNIT-001'),
          (select valor_cents from public.real_estate_units where organization_id='${GOV_ORG}' and external_id='UNIT-001'),
          (select status from public.real_estate_units where organization_id='${GOV_ORG}' and external_id='UNIT-001'),
          (select valor_cents from public.real_estate_price_list_items where organization_id='${GOV_ORG}' and external_id='PLI-001'),
          (select status from public.real_estate_price_list_items where organization_id='${GOV_ORG}' and external_id='PLI-001')
        );
      `),
    );
    expect(state).toBe("1|27500000|reservado|27500000|reservado");

    const history = lastLine(
      sql(`
        select string_agg(campo || ':' || coalesce(valor_anterior,'NULL') || '>' || coalesce(valor_novo,'NULL'), ',' order by campo)
          from public.real_estate_history
         where organization_id='${GOV_ORG}'
           and unit_id=(select id from public.real_estate_units where organization_id='${GOV_ORG}' and external_id='UNIT-001')
           and fonte='cv_crm';
      `),
    );
    expect(history).toContain("status:disponivel>reservado");
    expect(history).toContain("valor_cents:25000000>27500000");
  });

  it("dependencia ausente aborta atomicamente e nao marca staging como processed", () => {
    sql(`
      insert into public.cv_crm_staging
        (organization_id, batch_id, entity_type, external_id, raw_payload, validation_status)
      values
        ('${GOV_ORG}', '${BATCH_BAD}', 'unit', 'UNIT-BAD',
          '{"development_external_id":"DEV-INEXISTENTE","numero":"999","status":"disponivel"}', 'valid');
    `);

    expect(() => apply(GOV_ORG, BATCH_BAD)).toThrow(/CV_CRM_DEPENDENCY_MISSING/i);

    const state = lastLine(
      sql(`
        select concat_ws('|',
          (select count(*) from public.real_estate_units where organization_id='${GOV_ORG}' and external_id='UNIT-BAD'),
          (select validation_status from public.cv_crm_staging where organization_id='${GOV_ORG}' and batch_id='${BATCH_BAD}' and external_id='UNIT-BAD')
        );
      `),
    );
    expect(state).toBe("0|valid");
  });

  it("nao resolve dependencia de outro tenant", () => {
    sql(`
      insert into public.cv_crm_staging
        (organization_id, batch_id, entity_type, external_id, raw_payload, validation_status)
      values
        ('${ORG_B}', '${BATCH_CROSS}', 'unit', 'UNIT-CROSS',
          '{"development_external_id":"DEV-001","numero":"777","status":"disponivel"}', 'valid');
    `);

    expect(() => apply(ORG_B, BATCH_CROSS)).toThrow(/CV_CRM_DEPENDENCY_MISSING/i);
    expect(
      Number(
        lastLine(
          sql(`select count(*) from public.real_estate_units where organization_id='${ORG_B}' and external_id='UNIT-CROSS';`),
        ),
      ),
    ).toBe(0);
  });

  it("funcao apply e validator sao server-only e existe lock unico por tenant", () => {
    const privileges = lastLine(
      sql(`
        select concat_ws('|',
          has_function_privilege('anon', 'public.fn_apply_cv_crm_valid_records(uuid,uuid)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.fn_apply_cv_crm_valid_records(uuid,uuid)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.fn_apply_cv_crm_valid_records(uuid,uuid)', 'EXECUTE'),
          has_function_privilege('anon', 'public.fn_validate_cv_crm_record(text,jsonb)', 'EXECUTE'),
          has_function_privilege('authenticated', 'public.fn_validate_cv_crm_record(text,jsonb)', 'EXECUTE'),
          has_function_privilege('service_role', 'public.fn_validate_cv_crm_record(text,jsonb)', 'EXECUTE')
        );
      `),
    );
    expect(privileges).toBe("f|f|t|f|f|t");
    expect(indexExists("uq_cv_crm_one_running_per_org")).toBe(true);
  });
});
