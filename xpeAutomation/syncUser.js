const fs = require('fs');
const path = require('path');
const os = require('os');
const { launchXpeBrowser } = require('./launchBrowser');
const config = require('./config');
const { login } = require('./login');
const selectors = require('./selectors');

const LOG = '[xpe]';

function buildBaseUrl(ip, port) {
  const host = String(ip || '').trim();
  const p = Number(port ?? 80) || 80;
  const portPart = p === 80 ? '' : `:${p}`;
  return `http://${host}${portPart}`;
}

function resolvePhotoAbsolutePath(patient, userDataPath) {
  const rel = patient?.photo_path ? String(patient.photo_path).trim() : '';
  if (!rel || !userDataPath) return null;
  const safe = rel.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  const full = path.join(userDataPath, safe);
  if (fs.existsSync(full)) return full;
  return null;
}

/**
 * XPE exige imagem (manual: preferencialmente .jpg). Converte via Electron nativeImage quando possível.
 */
function ensureJpegForXpe(photoAbsolutePath) {
  if (!photoAbsolutePath || !fs.existsSync(photoAbsolutePath)) {
    return { ok: false, error: 'Paciente sem foto salva no AquaAccess.' };
  }
  const ext = path.extname(photoAbsolutePath).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') {
    return { ok: true, path: photoAbsolutePath, temporary: false };
  }

  try {
    // Disponível quando sync roda dentro do Electron (main process)
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    const { nativeImage } = require('electron');
    const img = nativeImage.createFromPath(photoAbsolutePath);
    if (img.isEmpty()) {
      return {
        ok: false,
        error: `Não foi possível ler a foto (${ext}). Salve de novo como JPG no cadastro.`,
      };
    }
    const jpgBuf = img.toJPEG(90);
    const tmp = path.join(
      os.tmpdir(),
      `aquaaccess-xpe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`
    );
    fs.writeFileSync(tmp, jpgBuf);
    console.log(`${LOG} foto convertida para JPG:`, tmp);
    return { ok: true, path: tmp, temporary: true };
  } catch (e) {
    return {
      ok: false,
      error: `O XPE prefere JPG. Foto atual é ${ext || 'desconhecida'} e não foi possível converter (${e?.message || e}).`,
    };
  }
}

async function captureErrorScreenshot(page, userDataPath, patientId, step) {
  if (!page || !userDataPath) return null;
  try {
    const dir = path.join(userDataPath, 'xpe-automation-errors');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = path.join(dir, `patient-${patientId || 'unknown'}-${step}-${stamp}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`${LOG} screenshot salvo:`, file);
    return file;
  } catch (e) {
    console.warn(`${LOG} não foi possível salvar screenshot:`, e?.message || e);
    return null;
  }
}

async function clickFirstVisible(page, selector, timeoutMs = 8000) {
  const loc = page.locator(selector);
  const count = await loc.count();
  for (let i = 0; i < count; i += 1) {
    const item = loc.nth(i);
    if (await item.isVisible({ timeout: 400 }).catch(() => false)) {
      await item.click({ timeout: timeoutMs });
      return true;
    }
  }
  return false;
}

async function navigateToUsers(page) {
  console.log(`${LOG} navigate: Controle de Acesso → Usuários`);

  const accessOk = await clickFirstVisible(page, selectors.nav.accessControl, 10000);
  if (!accessOk) {
    // Alguns firmwares já abrem com menu expandido
    console.warn(`${LOG} navigate: menu Controle de Acesso não clicado — tentando Usuários direto`);
  }
  await page.waitForTimeout(config.playwright.slowMo || 600);

  const usersOk = await clickFirstVisible(page, selectors.nav.usersMenu, 15000);
  if (!usersOk) {
    throw new Error(
      'Não encontrei o menu "Usuários" no painel do XPE. Confirme o login e o menu Controle de Acesso.'
    );
  }
  await page.waitForTimeout(config.playwright.slowMo || 800);
  console.log(`${LOG} navigate: lista de usuários`);
}

async function fillByNearbyLabel(page, labelText, value) {
  // Procura um input próximo ao texto do rótulo (layout de tabela Fanvil/Intelbras)
  const label = page.getByText(labelText, { exact: false }).first();
  if (!(await label.isVisible({ timeout: 3000 }).catch(() => false))) {
    return false;
  }
  const rowInput = label.locator(
    'xpath=ancestor::tr[1]//input[not(@type="hidden") and not(@type="button") and not(@type="submit") and not(@type="checkbox") and not(@type="file")][1]'
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

async function createUser(page, patient) {
  const userId = String(patient.id);
  const name = String(patient.full_name || '').trim() || `Paciente ${userId}`;

  console.log(`${LOG} createUser: id=${userId} nome=${name}`);

  const added = await clickFirstVisible(page, selectors.userForm.addButton, 8000);
  if (!added) {
    console.warn(`${LOG} createUser: botão Adicionar não encontrado — tentando formulário já aberto`);
  }
  await page.waitForTimeout(config.playwright.slowMo || 700);

  let idFilled = await fillByNearbyLabel(page, 'ID Usuário', userId);
  if (!idFilled) {
    idFilled = await fillByNearbyLabel(page, 'ID Usuario', userId);
  }
  if (!idFilled) {
    const idField = page.locator(selectors.userForm.userId).first();
    if (await idField.isVisible({ timeout: 4000 }).catch(() => false)) {
      await idField.fill(userId);
      idFilled = true;
    }
  }
  if (!idFilled) {
    return {
      ok: false,
      error:
        'Campo "ID Usuário" não encontrado no formulário do XPE. Abra Controle de Acesso → Usuários → Adicionar e confira o painel.',
    };
  }

  let nameFilled = await fillByNearbyLabel(page, 'Nome', name);
  if (!nameFilled) {
    const nameField = page.locator(selectors.userForm.name).first();
    if (await nameField.isVisible({ timeout: 3000 }).catch(() => false)) {
      await nameField.fill(name);
      nameFilled = true;
    }
  }
  if (!nameFilled) {
    console.warn(`${LOG} createUser: campo Nome não encontrado — seguindo com ID`);
  }

  console.log(`${LOG} createUser: formulário preenchido`);
  return { ok: true };
}

async function uploadPhoto(page, photoAbsolutePath) {
  console.log(`${LOG} uploadPhoto:`, photoAbsolutePath);

  await clickFirstVisible(page, selectors.photo.faceTab, 5000);
  await page.waitForTimeout(config.playwright.slowMo || 500);

  const fileInput = page.locator(selectors.photo.fileInput).first();
  const attached = await fileInput
    .waitFor({ state: 'attached', timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  if (!attached) {
    return {
      ok: false,
      error:
        'Campo de arquivo da aba Facial não encontrado. No XPE: Usuários → Adicionar → aba Facial → Selecionar arquivo.',
    };
  }

  await fileInput.setInputFiles(photoAbsolutePath);
  await page.waitForTimeout(800);

  // Alguns firmwares pedem "Carregar Foto" / "Aplicar" após escolher o arquivo
  await clickFirstVisible(page, selectors.photo.uploadConfirm, 4000);

  console.log(`${LOG} uploadPhoto: arquivo anexado`);
  return { ok: true };
}

async function saveRegistration(page) {
  console.log(`${LOG} save: clicando em Aplicar`);
  const saveBtn = page.locator(selectors.userForm.save).first();
  const visible = await saveBtn.isVisible({ timeout: 8000 }).catch(() => false);
  if (!visible) {
    // Fallback: qualquer input value Aplicar
    const ok = await clickFirstVisible(page, 'input[value="Aplicar"], button:has-text("Aplicar")', 5000);
    if (!ok) {
      throw new Error('Botão "Aplicar" não encontrado no XPE.');
    }
  } else {
    await saveBtn.click();
  }
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {
    console.log(`${LOG} save: networkidle timeout — continuando`);
  });
  await page.waitForTimeout(1200);
  console.log(`${LOG} save: Aplicar enviado`);
}

async function verifyUserOnDevice(page, userId) {
  const id = String(userId);
  // Volta à lista se ainda estiver no formulário
  await clickFirstVisible(page, selectors.nav.usersMenu, 5000);
  await page.waitForTimeout(1000);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  if (bodyText.includes(id)) {
    return { ok: true };
  }

  // Tenta campo de busca se existir
  const search = page.locator('input[type="text"]').first();
  if (await search.isVisible({ timeout: 1500 }).catch(() => false)) {
    await search.fill(id);
    await page.waitForTimeout(800);
    const again = await page.locator('body').innerText().catch(() => '');
    if (again.includes(id)) return { ok: true };
  }

  return {
    ok: false,
    error: `Após Aplicar, o ID ${id} não apareceu na lista de usuários do XPE. O cadastro provavelmente não foi gravado.`,
  };
}

/**
 * Sincroniza um paciente no painel web do Intelbras XPE via Playwright.
 */
async function syncUserToXPE(patient, options = {}) {
  const ip = String(options.ip || '').trim();
  const port = options.port != null ? Number(options.port) : 80;
  const username = String(options.username || '').trim();
  const password = options.password != null ? String(options.password) : '';
  const userDataPath = options.userDataPath || '';

  if (!ip) {
    return { ok: false, error: 'IP do XPE não informado. Configure em Configurações.' };
  }
  if (!username) {
    return { ok: false, error: 'Usuário web do XPE não informado. Configure em Configurações.' };
  }
  if (!password) {
    return {
      ok: false,
      error: 'Senha web do XPE não salva. Digite a senha em Configurações e clique em Salvar alterações.',
    };
  }

  const baseUrl = buildBaseUrl(ip, port);
  const rawPhoto = resolvePhotoAbsolutePath(patient, userDataPath);
  const jpeg = ensureJpegForXpe(rawPhoto);
  if (!jpeg.ok) {
    return { ok: false, error: jpeg.error };
  }

  console.log(`${LOG} syncUserToXPE: paciente id=${patient?.id} url=${baseUrl}`);

  let browser;
  let page;
  let tmpPhoto = jpeg.temporary ? jpeg.path : null;

  try {
    browser = await launchXpeBrowser({
      headless: options.headless ?? config.playwright.headless,
      slowMo: options.slowMo ?? config.playwright.slowMo,
    });

    const context = await browser.newContext({
      ignoreHTTPSErrors: Boolean(config.playwright.ignoreHTTPSErrors),
    });
    page = await context.newPage();
    page.setDefaultTimeout(options.timeoutMs ?? config.playwright.defaultTimeoutMs ?? 30000);

    console.log(`${LOG} sync: abrindo painel`);
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });

    const loginResult = await login(page, { username, password });
    if (!loginResult.ok) {
      const screenshot = await captureErrorScreenshot(page, userDataPath, patient?.id, 'login');
      return { ok: false, error: loginResult.error, screenshot };
    }

    await navigateToUsers(page);

    const createResult = await createUser(page, patient);
    if (!createResult.ok) {
      const screenshot = await captureErrorScreenshot(page, userDataPath, patient?.id, 'create');
      return { ok: false, error: createResult.error, screenshot };
    }

    const uploadResult = await uploadPhoto(page, jpeg.path);
    if (!uploadResult.ok) {
      const screenshot = await captureErrorScreenshot(page, userDataPath, patient?.id, 'upload');
      return { ok: false, error: uploadResult.error, screenshot };
    }

    await saveRegistration(page);

    const verify = await verifyUserOnDevice(page, patient?.id);
    if (!verify.ok) {
      const screenshot = await captureErrorScreenshot(page, userDataPath, patient?.id, 'verify');
      return { ok: false, error: verify.error, screenshot };
    }

    console.log(`${LOG} syncUserToXPE: usuário ${patient?.id} confirmado na lista do XPE`);
    return { ok: true, patientId: patient?.id };
  } catch (err) {
    const msg = String(err?.message || err);
    console.error(`${LOG} syncUserToXPE: erro`, msg);
    const screenshot = await captureErrorScreenshot(page, userDataPath, patient?.id, 'error');
    return { ok: false, error: msg, screenshot };
  } finally {
    if (tmpPhoto) {
      try {
        fs.unlinkSync(tmpPhoto);
      } catch {
        /* ignore */
      }
    }
    if (browser) {
      await browser.close();
      console.log(`${LOG} sync: browser encerrado`);
    }
  }
}

module.exports = {
  syncUserToXPE,
  buildBaseUrl,
  resolvePhotoAbsolutePath,
  ensureJpegForXpe,
};
