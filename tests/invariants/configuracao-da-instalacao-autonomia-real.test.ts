import { randomUUID } from "node:crypto";

import pg from "pg";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { pgComoSupabase } from "../pg-como-supabase";

const container = process.env.TEST_DB_CONTAINER;
if (!container) {
  throw new Error("TEST_DB_CONTAINER not set — rode via `pnpm test:db` (scripts/test-db.sh)");
}

const ACTOR = "7f500000-0000-4000-8000-000000000001";
const CHAVE = "RESEND_API_KEY";
const AES_KEY = "iBc1Z2gYaAH4rEHs1dHQ2dvNQ6t4OfrdE1/Y6OSvtZY=";
const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
  max: 2,
});
const database = pgComoSupabase(pool);

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => database }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn(async () => ({ user: { id: ACTOR } })),
}));
vi.mock("@/lib/env", async (original) => {
  const originalModule = await original<typeof import("@/lib/env")>();
  return {
    ...originalModule,
    env: {
      ...originalModule.env,
      AI_CRED_AES_KEY: AES_KEY,
      SUPABASE_SERVICE_ROLE_KEY: "local-test-admin",
      RESEND_API_KEY: "",
    },
  };
});

beforeAll(async () => {
  await pool.query("delete from platform_config where chave = $1", [CHAVE]);
  await pool.query("delete from api_audit_log where actor_user_id = $1", [ACTOR]);
  await pool.query(
    "insert into auth.users (id, email) values ($1, 'crivo-75f@invariant.test') on conflict (id) do nothing",
    [ACTOR],
  );
});

afterAll(async () => {
  await pool.query("delete from platform_config where chave = $1", [CHAVE]);
  await pool.query("delete from api_audit_log where actor_user_id = $1", [ACTOR]);
  await pool.query("delete from auth.users where id = $1", [ACTOR]);
  await pool.end();
});

it("alteração -> persistência cifrada -> audit -> reset devolve exatamente ao estado inicial", async () => {
  const segredo = `re_crivo_75f_${randomUUID()}_9f3a`;
  const { estadoParaTela } = await import("@/lib/instalacao/config");
  const { salvarConfiguracaoDaInstalacao, voltarConfiguracaoAoPadrao } = await import(
    "@/app/actions/admin/salvarConfiguracaoDaInstalacao"
  );

  const original = await estadoParaTela(CHAVE, true);
  expect(original).toMatchObject({
    chave: CHAVE,
    fonte: "ausente",
    configurado: false,
    last4: null,
    ehSegredo: true,
    valorVisivel: null,
  });

  const salvo = await salvarConfiguracaoDaInstalacao(CHAVE, segredo);
  expect(salvo).toEqual({
    ok: true,
    estado: {
      chave: CHAVE,
      fonte: "banco",
      configurado: true,
      last4: "9f3a",
      ehSegredo: true,
      valorVisivel: null,
    },
  });

  const persistido = await pool.query<{
    valor: string | null;
    ciphertext: Buffer | null;
    iv: Buffer | null;
    tag: Buffer | null;
    last4: string | null;
    eh_segredo: boolean;
    semeado_do_env: boolean;
    raw: string;
  }>(
    `select valor, ciphertext, iv, tag, last4, eh_segredo, semeado_do_env,
            row_to_json(platform_config)::text as raw
       from platform_config where chave = $1`,
    [CHAVE],
  );
  expect(persistido.rows).toHaveLength(1);
  const persistidoRow = persistido.rows[0]!;
  expect(persistido.rows[0]).toMatchObject({
    valor: null,
    last4: "9f3a",
    eh_segredo: true,
    semeado_do_env: false,
  });
  expect(persistidoRow.ciphertext).toBeInstanceOf(Buffer);
  expect(persistidoRow.iv).toBeInstanceOf(Buffer);
  expect(persistidoRow.tag).toBeInstanceOf(Buffer);
  expect(persistidoRow.raw).not.toContain(segredo);

  const alteracao = await pool.query<{
    actor_user_id: string;
    acting_as_platform_admin: boolean;
    resource_type: string | null;
    metadata: Record<string, unknown>;
  }>(
    `select actor_user_id, acting_as_platform_admin, resource_type, metadata
       from api_audit_log
      where actor_user_id = $1 and action = 'platform.config_changed'
      order by created_at desc limit 1`,
    [ACTOR],
  );
  expect(alteracao.rows).toHaveLength(1);
  const alteracaoRow = alteracao.rows[0]!;
  expect(alteracao.rows[0]).toMatchObject({
    actor_user_id: ACTOR,
    acting_as_platform_admin: true,
    resource_type: "platform_config",
    metadata: { chave: CHAVE, last4: "9f3a", natureza: "segredo" },
  });
  expect(JSON.stringify(alteracaoRow.metadata)).not.toContain(segredo);

  const restaurado = await voltarConfiguracaoAoPadrao(CHAVE);
  expect(restaurado).toEqual({ ok: true, estado: original });

  const depoisDoReset = await pool.query("select 1 from platform_config where chave = $1", [CHAVE]);
  expect(depoisDoReset.rowCount).toBe(0);

  const reset = await pool.query<{
    actor_user_id: string;
    acting_as_platform_admin: boolean;
    resource_type: string | null;
    metadata: Record<string, unknown>;
  }>(
    `select actor_user_id, acting_as_platform_admin, resource_type, metadata
       from api_audit_log
      where actor_user_id = $1 and action = 'platform.config_reset'
      order by created_at desc limit 1`,
    [ACTOR],
  );
  expect(reset.rows).toHaveLength(1);
  const resetRow = reset.rows[0]!;
  expect(reset.rows[0]).toMatchObject({
    actor_user_id: ACTOR,
    acting_as_platform_admin: true,
    resource_type: "platform_config",
    metadata: { chave: CHAVE },
  });
  expect(JSON.stringify(resetRow.metadata)).not.toContain(segredo);

  const final = await estadoParaTela(CHAVE, true);
  expect(final).toEqual(original);
});
