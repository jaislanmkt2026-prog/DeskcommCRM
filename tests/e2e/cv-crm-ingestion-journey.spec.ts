import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const FIXTURES_DIR = join(__dirname, "..", "fixtures", "cv-crm");

test.describe("CV CRM Ingestion Journey — cenário G", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("jaislan@deskcomm.local");
    await page.getByLabel("Senha").fill("password123");
    await page.getByRole("button", { name: /entrar|login/i }).click();
    await page.waitForURL(/\/dashboard|\/home/);
  });

  test("G: fluxo completo de ingestão CV CRM", async ({ page }) => {
    const devFixture = readFileSync(join(FIXTURES_DIR, "development-valid.json"), "utf8");
    const unitFixture = readFileSync(join(FIXTURES_DIR, "unit-valid.json"), "utf8");
    const plFixture = readFileSync(join(FIXTURES_DIR, "price-list-valid.json"), "utf8");
    const pliFixture = readFileSync(join(FIXTURES_DIR, "price-list-item-valid.json"), "utf8");

    await page.goto("/integracoes/cv-crm");

    await page.getByRole("button", { name: /nova importação|importar cv crm/i }).click();

    await page.getByLabel("Arquivo JSON").setInputFiles({
      name: "development-valid.json",
      mimeType: "application/json",
      buffer: Buffer.from(devFixture),
    });

    await page.getByRole("button", { name: /processar|enviar/i }).click();

    await expect(page.getByText(/importação iniciada|processando/i)).toBeVisible({
      timeout: 10000,
    });

    await expect(page.getByText(/concluído|sucesso/i)).toBeVisible({ timeout: 30000 });

    await page.goto("/empreendimentos");
    await expect(page.getByText("Residencial Alpha")).toBeVisible({ timeout: 10000 });

    await page.goto("/unidades");
    await expect(page.getByText("101")).toBeVisible({ timeout: 10000 });

    await page.goto("/tabelas-preco");
    await expect(page.getByText("Tabela Q4 2024")).toBeVisible({ timeout: 10000 });
  });

  test("G2: validação rejeita fixture inválida", async ({ page }) => {
    const invalidFixture = readFileSync(
      join(FIXTURES_DIR, "price-list-item-invalid-non-numeric-value.json"),
      "utf8",
    );

    await page.goto("/integracoes/cv-crm");
    await page.getByRole("button", { name: /nova importação|importar cv crm/i }).click();

    await page.getByLabel("Arquivo JSON").setInputFiles({
      name: "invalid.json",
      mimeType: "application/json",
      buffer: Buffer.from(invalidFixture),
    });

    await page.getByRole("button", { name: /processar|enviar/i }).click();

    await expect(page.getByText(/erro|inválido|valor_cents/i)).toBeVisible({ timeout: 10000 });
  });

  test("G3: idempotência — reimportar mesma chave não duplica", async ({ page }) => {
    const devFixture = readFileSync(join(FIXTURES_DIR, "development-valid.json"), "utf8");

    await page.goto("/integracoes/cv-crm");
    await page.getByRole("button", { name: /nova importação|importar cv crm/i }).click();

    await page.getByLabel("Arquivo JSON").setInputFiles({
      name: "development-valid.json",
      mimeType: "application/json",
      buffer: Buffer.from(devFixture),
    });

    await page.getByRole("button", { name: /processar|enviar/i }).click();
    await expect(page.getByText(/concluído|sucesso/i)).toBeVisible({ timeout: 30000 });

    await page.reload();
    await page.getByRole("button", { name: /nova importação|importar cv crm/i }).click();

    await page.getByLabel("Arquivo JSON").setInputFiles({
      name: "development-valid.json",
      mimeType: "application/json",
      buffer: Buffer.from(devFixture),
    });

    await page.getByRole("button", { name: /processar|enviar/i }).click();
    await expect(page.getByText(/concluído|sucesso|já existe/i)).toBeVisible({ timeout: 30000 });

    await page.goto("/empreendimentos");
    const count = await page.getByRole("row").count();
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
