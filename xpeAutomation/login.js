const selectors = require('./selectors');

const LOG = '[xpe]';

/**
 * Preenche formulário de login no painel web do XPE 3200 PLUS IP.
 * @param {import('playwright').Page} page
 * @param {{ username: string, password: string }} credentials
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function login(page, credentials) {
  const username = String(credentials?.username || '').trim();
  const password = String(credentials?.password ?? '');

  if (!username) {
    return { ok: false, error: 'Usuário XPE não informado.' };
  }
  if (!password) {
    return {
      ok: false,
      error: 'Senha web do XPE não informada. Salve a senha em Configurações → Conexão Intelbras.',
    };
  }

  console.log(`${LOG} login: preenchendo credenciais (usuário=${username})`);

  try {
    const userField = page.locator(selectors.login.username).first();
    await userField.waitFor({ state: 'visible', timeout: 20000 });
    await userField.fill('');
    await userField.fill(username);

    const passField = page.locator(selectors.login.password).first();
    await passField.waitFor({ state: 'visible', timeout: 10000 });
    await passField.click({ clickCount: 3 }).catch(() => {});
    await passField.fill('');
    await passField.fill(password);

    console.log(`${LOG} login: clicando em #Login`);
    const submitBtn = page.locator(selectors.login.submit).first();
    await submitBtn.waitFor({ state: 'visible', timeout: 10000 });
    await Promise.all([
      page.waitForLoadState('domcontentloaded', { timeout: 25000 }).catch(() => null),
      submitBtn.click(),
    ]);
    await page.waitForTimeout(1500);

    const failText = page.locator('text=Login falhou, text=Login Failed, #cLoginResult');
    if (await failText.first().isVisible({ timeout: 1500 }).catch(() => false)) {
      const msg = (await failText.first().textContent().catch(() => '')) || 'Login falhou';
      return { ok: false, error: `Login rejeitado pelo XPE: ${String(msg).trim()}` };
    }

    const stillLogin =
      (await page.locator(selectors.login.password).first().isVisible().catch(() => false)) &&
      (await page.locator(selectors.login.submit).first().isVisible().catch(() => false));

    if (stillLogin) {
      return {
        ok: false,
        error: 'Login não confirmado. Verifique usuário/senha web do XPE em Configurações.',
      };
    }

    console.log(`${LOG} login: concluído`);
    return { ok: true };
  } catch (err) {
    const msg = String(err?.message || err);
    console.error(`${LOG} login: erro`, msg);
    return { ok: false, error: msg };
  }
}

module.exports = { login };
