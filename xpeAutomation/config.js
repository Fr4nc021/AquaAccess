/**
 * Defaults só para `npm run xpe:test` (CLI).
 * O app Electron usa IP/credenciais salvos em Configurações (device-settings + bridge).
 */
module.exports = {
  xpe: {
    ip: '192.168.15.86',
    port: 80,
    username: 'admin',
    password: 'admin',
  },
  playwright: {
    headless: false,
    slowMo: 500,
    defaultTimeoutMs: 30000,
    ignoreHTTPSErrors: true,
  },
};
