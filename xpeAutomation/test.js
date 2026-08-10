/**
 * Teste isolado: abre o painel web do XPE no Chromium (Playwright).
 * Uso: npm run xpe:test
 */
const { chromium } = require('playwright');
const config = require('./config');

function buildBaseUrl(ip, port) {
  const host = String(ip || config.xpe.ip).trim();
  const p = Number(port ?? config.xpe.port) || 80;
  const portPart = p === 80 ? '' : `:${p}`;
  return `http://${host}${portPart}`;
}

async function main() {
  const ip = process.env.XPE_IP || config.xpe.ip;
  const port = process.env.XPE_PORT ? Number(process.env.XPE_PORT) : config.xpe.port;
  const baseUrl = buildBaseUrl(ip, port);

  console.log('[xpe] Iniciando teste de acesso ao painel…');
  console.log('[xpe] URL:', baseUrl);
  console.log('[xpe] headless:', config.playwright.headless, 'slowMo:', config.playwright.slowMo);

  const browser = await chromium.launch({
    headless: config.playwright.headless,
    slowMo: config.playwright.slowMo,
  });

  const context = await browser.newContext({
    ignoreHTTPSErrors: Boolean(config.playwright.ignoreHTTPSErrors),
  });
  const page = await context.newPage();
  page.setDefaultTimeout(config.playwright.defaultTimeoutMs || 30000);

  try {
    console.log('[xpe] Navegando…');
    const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    const status = response ? response.status() : '—';
    console.log('[xpe] HTTP status:', status);
    console.log('[xpe] Título da página:', await page.title());
    console.log('[xpe] Teste OK — janela aberta por 15s para inspeção visual.');
    await page.waitForTimeout(15000);
  } catch (err) {
    console.error('[xpe] Falha no teste:', err?.message || err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    console.log('[xpe] Browser encerrado.');
  }
}

main();
