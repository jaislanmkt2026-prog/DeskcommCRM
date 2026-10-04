/**
 * Invariante: tabelas real_estate_* e constructors têm grants server-only.
 *
 * Prova o forward-fix da migration 0535: nenhuma dessas tabelas pode ter
 * INSERT/UPDATE/DELETE concedido a anon ou authenticated além do SELECT
 * explícito (RLS filtra tenant). service_role tem CRUD completo (filtro
 * manual de organization_id no código). public/anon não têm nada.
 *
 * Contexto: auditoria CV CRM achou que essas tabelas nasceram sem REVOKE
 * explícito, herdando o default ACL do Supabase que concede tudo a todos.
 * service_role ignora RLS — sem revoke, qualquer chamada com service key
 * lê/escreve todos os tenants.
 */
import { describe, expect, it } from "vitest";
import { sql } from "./psql-transporte";

const TABLES = [
  "real_estate_developments",
  "real_estate_units",
  "real_estate_price_lists",
  "real_estate_price_list_items",
  "real_estate_history",
  "constructors",
] as const;

function getGrants(table: string, grantee: string): string[] {
  const raw = sql(`
    select privilege_type
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = '${table}'
      and grantee = '${grantee}'
    order by privilege_type;
  `);
  if (!raw) return [];
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

describe("grants server-only em tabelas real_estate e constructors (migration 0535)", () => {
  it.each(TABLES)("%s NÃO tem INSERT/UPDATE/DELETE concedido a authenticated", (table) => {
    const grants = getGrants(table, "authenticated");
    const writeGrants = grants.filter((p) => ["INSERT", "UPDATE", "DELETE"].includes(p));
    expect(writeGrants).toEqual([]);
  });

  it.each(TABLES)("%s tem SELECT concedido a authenticated (RLS filtra tenant)", (table) => {
    const grants = getGrants(table, "authenticated");
    expect(grants).toContain("SELECT");
  });

  it.each(TABLES)("%s tem CRUD completo concedido a service_role", (table) => {
    const grants = getGrants(table, "service_role");
    const expected = ["SELECT", "INSERT", "UPDATE", "DELETE"];
    for (const priv of expected) {
      expect(grants).toContain(priv);
    }
  });

  it.each(TABLES)("%s NÃO tem nenhum grant a anon ou PUBLIC", (table) => {
    const anonGrants = getGrants(table, "anon");
    const publicGrants = getGrants(table, "PUBLIC");
    expect(anonGrants).toEqual([]);
    expect(publicGrants).toEqual([]);
  });
});
