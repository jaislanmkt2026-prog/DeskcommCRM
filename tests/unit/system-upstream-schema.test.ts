import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const migration = readFileSync(
  join(ROOT, "supabase", "migrations", "20260925200000_0416_crivo_interno_upstream.sql"),
  "utf8",
);

describe("Crivo interno é da instalação, não do tenant", () => {
  it("as duas tabelas não carregam organization_id e fecham acesso de usuário", () => {
    const sqlExecutavel = migration
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(migration).toContain("create table if not exists public.system_upstream_state");
    expect(migration).toContain("create table if not exists public.system_upstream_checks");
    expect(sqlExecutavel).not.toContain("organization_id");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on table public.system_upstream_state from public, anon, authenticated");
    expect(migration).toContain("revoke all on table public.system_upstream_checks from public, anon, authenticated");
  });
});
