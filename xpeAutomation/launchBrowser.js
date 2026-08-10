/**
 * Lança navegador para Playwright no PC do clube sem exigir
 * `npx playwright install chromium` (usa Chrome ou Edge do Windows).
 */
const { chromium } = require('playwright');

/**
 * @param {{ headless?: boolean, slowMo?: number }} opts
 * @returns {Promise<import('playwright').Browser>}
 */
async function launchXpeBrowser(opts = {}) {
  const headless = Boolean(opts.headless);
  const slowMo = Number(opts.slowMo) || 0;
  const attempts = [
    { channel: 'chrome' },
    { channel: 'msedge' },
    {}, // Chromium baixado pelo Playwright (se existir)
  ];

  let lastErr = null;
  for (const extra of attempts) {
    try {
      const browser = await chromium.launch({
        headless,
        slowMo,
        ...extra,
      });
      const via = extra.channel || 'playwright-chromium';
      console.log(`[xpe] browser: ${via} (headless=${headless})`);
      return browser;
    } catch (e) {
      lastErr = e;
      console.warn(`[xpe] launch falhou (${extra.channel || 'chromium'}):`, String(e?.message || e));
    }
  }

  throw new Error(
    `${String(lastErr?.message || lastErr)}\n\n` +
      'Não foi possível abrir Chrome/Edge/Chromium. Instale o Google Chrome neste PC ' +
      'ou rode: npm run xpe:install-browser'
  );
}

module.exports = { launchXpeBrowser };
