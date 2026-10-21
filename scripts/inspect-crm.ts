import { chromium } from "@playwright/test";
import * as path from "path";

async function main() {
  console.log("Iniciando Chromium com Google Chrome...");
  const browser = await chromium.launch({
    executablePath: "C:\\Users\\okaso\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe",
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--ignore-certificate-errors"],
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
  });

  const page = await context.newPage();

  console.log("Navegando para https://localhost/login ...");
  await page.goto("https://localhost/login", { waitUntil: "networkidle", timeout: 30000 });

  console.log("Preenchendo credenciais do Jaislan...");
  await page.fill('input[type="email"]', "jaislan@deskcomm.local");
  await page.fill('input[type="password"]', "jaislan35");

  console.log("Clicando em Entrar...");
  await page.click('button[type="submit"]');

  console.log("Aguardando navegação ou resposta...");
  await page.waitForTimeout(6000);

  const currentUrl = page.url();
  const title = await page.title();
  console.log("URL Atual:", currentUrl);
  console.log("Título:", title);

  const screenshotPath = path.resolve("C:/Users/okaso/.gemini/antigravity/brain/9667b2ee-e238-4273-93dd-879a7d62b0b0/crm_logged_screenshot.png");
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("Screenshot salvo em:", screenshotPath);

  const bodyText = await page.evaluate(() => document.body.innerText);
  console.log("--- TEXTO DA TELA ---");
  console.log(bodyText.substring(0, 2000));
  console.log("--- FIM TEXTO ---");

  // Capturar menu/links de navegação
  const navLinks = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("nav a, aside a, header a, [role='navigation'] a"));
    return links.map(a => ({
      text: a.textContent?.trim(),
      href: a.getAttribute("href")
    }));
  });
  console.log("Navegação:", JSON.stringify(navLinks, null, 2));

  await browser.close();
}

main().catch(err => {
  console.error("Erro:", err);
  process.exit(1);
});
