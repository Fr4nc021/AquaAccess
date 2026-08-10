/**
 * Playwright: cadastra usuário no painel XPE 3200 PLUS IP
 * (ID Usuário, Nome, Facial → Selecionar, Aplicar).
 */
const fs = require('fs');
const path = require('path');
const { login } = require('../xpeAutomation/login');
const { launchXpeBrowser } = require('../xpeAutomation/launchBrowser');

const LOG = '[medico-web/xpe]';

function parseBaseUrl(xpeUrl) {
  const raw = String(xpeUrl || '').trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    return `${u.protocol}//${u.hostname}${u.port && u.port !== '80' && u.port !== '443' ? `:${u.port}` : ''}`;
  } catch {
    return null;
  }
}

async function clickFirstVisible(page, selector, timeoutMs = 8000) {
  const loc = page.locator(selector);
  const count = await loc.count();
  for (let i = 0; i < Math.min(count, 12); i += 1) {
    const item = loc.nth(i);
    if (await item.isVisible({ timeout: 350 }).catch(() => false)) {
      await item.click({ timeout: timeoutMs });
      return true;
    }
  }
  return false;
}

async function fillByLabel(page, labelText, value) {
  const label = page.getByText(labelText, { exact: false }).first();
  if (!(await label.isVisible({ timeout: 4000 }).catch(() => false))) return false;

  const rowInput = label.locator(
    'xpath=ancestor::tr[1]//input[not(@type="hidden") and not(@type="button") and not(@type="submit") and not(@type="checkbox") and not(@type="file") and not(@type="radio")][1]'
  );
  if (await rowInput.count()) {
    await rowInput.first().fill(String(value));
    return true;
  }
  const following = label.locator(
    'xpath=following::input[not(@type="hidden") and not(@type="button") and not(@type="submit") and not(@type="file")][1]'
  );
  if (await following.count()) {
    await following.first().fill(String(value));
    return true;
  }
  return false;
}

async function captureError(page, errorsDir, userId, step) {
  try {
    fs.mkdirSync(errorsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(errorsDir, `id-${userId}-${step}-${stamp}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch {
    return null;
  }
}

async function navigateToUserForm(page) {
  await clickFirstVisible(
    page,
    '#tMenu160, #accesscontrol_top_menu, a:has-text("Controle de Acesso"), text=Controle de Acesso',
    12000
  );
  await page.waitForTimeout(600);

  const users = await clickFirstVisible(page, '#tUser, a:has-text("Usuários"), text=Usuários', 15000);
  if (!users) {
    throw new Error('Menu "Usuários" não encontrado no XPE.');
  }
  await page.waitForTimeout(800);

  const add = await clickFirstVisible(
    page,
    'input[value="Adicionar"], button:has-text("Adicionar"), a:has-text("Adicionar"), text=Adicionar',
    10000
  );
  if (!add) {
    throw new Error('Botão "Adicionar" não encontrado na lista de usuários.');
  }
  await page.waitForTimeout(900);
}

async function fillBasicFields(page, userId, name) {
  let okId = await fillByLabel(page, 'ID Usuário', userId);
  if (!okId) okId = await fillByLabel(page, 'ID Usuario', userId);
  if (!okId) {
    const fallback = page.locator('#cUserID, #cUserId, input[name="UserID"], input[id*="UserID" i]').first();
    if (await fallback.isVisible({ timeout: 3000 }).catch(() => false)) {
      await fallback.fill(String(userId));
      okId = true;
    }
  }
  if (!okId) {
    throw new Error('Campo "ID Usuário" não encontrado no formulário do XPE.');
  }

  let okName = await fillByLabel(page, 'Nome', name);
  if (!okName) {
    const byId = page.locator('#cUserName, #cDisplayName, input[name="UserName"]').first();
    if (await byId.isVisible({ timeout: 2500 }).catch(() => false)) {
      await byId.fill(String(name));
      okName = true;
    }
  }
  if (!okName) {
    console.warn(`${LOG} campo Nome não encontrado — seguindo só com ID`);
  }
}

async function uploadFacePhoto(page, photoPath) {
  await clickFirstVisible(page, 'text=Facial, a:has-text("Facial"), text=Face', 6000);
  await page.waitForTimeout(500);

  const fileInput = page.locator('input[type="file"]').first();
  const attached = await fileInput
    .waitFor({ state: 'attached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!attached) {
    throw new Error('Input de arquivo da aba Facial não encontrado (botão Selecionar).');
  }
  await fileInput.setInputFiles(photoPath);
  await page.waitForTimeout(700);

  // Alguns firmwares só anexam; outros pedem Carregar Foto / Aplicar parcial
  await clickFirstVisible(
    page,
    'input[value="Selecionar"], button:has-text("Selecionar"), .input_file_btn, input[value="Carregar Foto"]',
    3000
  );
}

async function applyAndVerify(page, userId) {
  const applied = await clickFirstVisible(
    page,
    'input[value="Aplicar"], button:has-text("Aplicar"), input[type="button"][value="Aplicar"]',
    10000
  );
  if (!applied) {
    throw new Error('Botão "Aplicar" não encontrado.');
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(1200);

  await clickFirstVisible(page, '#tUser, a:has-text("Usuários"), text=Usuários', 8000);
  await page.waitForTimeout(1000);

  const body = await page.locator('body').innerText().catch(() => '');
  if (!body.includes(String(userId))) {
    throw new Error(
      `Após Aplicar, o ID ${userId} não apareceu na lista de Usuários do XPE. Cadastro provavelmente não gravou.`
    );
  }
}

/**
 * @param {{ userId: string|number, name: string, photoPath: string, xpeUrl: string, xpeUser: string, xpePassword: string, headless?: boolean, slowMo?: number, errorsDir?: string }} opts
 */
async function syncRegistrationToXpe(opts) {
  const userId = String(opts.userId || '').trim();
  const name = String(opts.name || '').trim();
  const photoPath = String(opts.photoPath || '').trim();
  const baseUrl = parseBaseUrl(opts.xpeUrl);
  const username = String(opts.xpeUser || '').trim();
  const password = String(opts.xpePassword ?? '');
  const errorsDir = opts.errorsDir || path.join(__dirname, 'data', 'errors');

  if (!userId) return { ok: false, error: 'ID inválido.' };
  if (!name) return { ok: false, error: 'Nome obrigatório.' };
  if (!photoPath || !fs.existsSync(photoPath)) {
    return { ok: false, error: 'Arquivo de foto não encontrado.' };
  }
  if (!baseUrl) return { ok: false, error: 'URL/IP do XPE inválido em config.json.' };
  if (!username) return { ok: false, error: 'Usuário web do XPE não configurado.' };
  if (!password || password === 'COLOQUE_A_SENHA_WEB_DO_XPE') {
    return { ok: false, error: 'Configure xpePassword em medico-web/config.json.' };
  }

  console.log(`${LOG} sync id=${userId} url=${baseUrl}`);

  let browser;
  let page;
  try {
    const headless = Boolean(opts.headless);
    browser = await launchXpeBrowser({
      headless,
      slowMo: Number(opts.slowMo) || (headless ? 200 : 400),
    });

    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await context.newPage();
    page.setDefaultTimeout(35000);

    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    const loginResult = await login(page, { username, password });
    if (!loginResult.ok) {
      const shot = await captureError(page, errorsDir, userId, 'login');
      return { ok: false, error: loginResult.error, screenshot: shot };
    }

    await navigateToUserForm(page);
    await fillBasicFields(page, userId, name);
    await uploadFacePhoto(page, photoPath);
    await applyAndVerify(page, userId);

    console.log(`${LOG} OK — ID ${userId} na lista do XPE`);
    return { ok: true, userId, baseUrl };
  } catch (err) {
    const msg = String(err?.message || err);
    console.error(`${LOG} erro:`, msg);
    const shot = await captureError(page, errorsDir, userId, 'error');
    return { ok: false, error: msg, screenshot: shot };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

module.exports = { syncRegistrationToXpe, parseBaseUrl };
