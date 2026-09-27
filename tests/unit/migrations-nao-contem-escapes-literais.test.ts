import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REGRESSÃO: migrations ativas não podem conter escapes literais (`r`n, `n`)
 * em lugar de quebras de linha reais.
 *
 * Causa raiz: commit 376f96665 introduziu literalmente os chars U+0060 U+0072
 * U+0060 U+006E entre `property_proposals` e `add constraint` na migration
 * 0436_price_lists.sql, quebrando a sintaxe SQL. Este teste garante que nenhuma
 * migration ativa reintroduza esse padrão.
 */
const MIGRATIONS_DIR = join(__dirname, "..", "..", "supabase", "migrations");

function activeMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => !f.startsWith("_legacy"))
    .map((f) => join(MIGRATIONS_DIR, f));
}

describe("migrations ativas não contêm escapes literais backtick-r-backtick-n ou backtick-n", () => {
  const arquivos = activeMigrationFiles();

  it("nenhuma migration ativa contém literal `r`n ou `n` em vez de newline real", () => {
    const ofensores: string[] = [];
    for (const arquivo of arquivos) {
      const conteudo = readFileSync(arquivo, "utf8");
      // Padrão: backtick + r/n + backtick — escape literal que não é newline real
      if (/`[rn]`/.test(conteudo)) {
        ofensores.push(arquivo.replace(MIGRATIONS_DIR + "\\", ""));
      }
    }
    expect(
      ofensores,
      `${ofensores.length} migration(ões) com escapes literais \`r\`n ou \`n\`: ${ofensores.join(", ")}. ` +
        "Substitua por quebra de linha real.",
    ).toEqual([]);
  });
});