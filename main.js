const fs = require('fs');
const net = require('net');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron');

if (!app.isPackaged) {
  try {
    require('electron-reloader')(module);
  } catch {
    /* devDependency ausente em produção */
  }
}

const path = require('path');
const {
  initDb,
  authenticateUser,
  createPatient,
  setPatientPhotoPath,
  getPatientById,
  findPatientIdByCpf,
  searchPatientsByName,
  updatePatient,
  deletePatientById,
  removePatient,
  listPatients,
  listPatientsOverview,
  setPatientBlocked,
  listExamsDone,
  deleteExamById,
  createExam,
  registerPoolAccess,
  listAccessEvents,
  accessStatsToday,
  adminReportsSummary,
  adminReportsRows,
  getLocalDbStats,
  dashboardSnapshot,
  findPatientIdForXpeBridge,
} = require('./db');

const { startXpeBridge } = require('./xpeBridge');
const { syncUserToXPE } = require('./xpeAutomation/syncUser');
const {
  getLocalNetworkInfo,
  parseIntelbrasDeviceUrl,
  probeIntelbrasDevice,
  buildSetupPlan,
  buildActionUrlLogAccess,
  resolvePcLanIp,
  normalizeIpv4Loose,
  DEFAULT_BRIDGE_PORT,
} = require('./xpeSetup');

function resolveLanIpForBridge(deviceHost, savedLanIp) {
  const net = getLocalNetworkInfo({ deviceHost, savedLanIp });
  const lan = resolvePcLanIp({
    addresses: net.addresses,
    deviceHost,
    savedLanIp,
  });
  return lan || net.preferredLanIp || net.autoDetectedLanIp || null;
}

const DEFAULT_XPE_BRIDGE_SETTINGS = {
  enabled: false,
  port: 37891,
  host: '0.0.0.0',
  path: '/intelbras/xpe',
  sharedSecret: '',
  openDoorWhenGranted: false,
  openDoorBaseUrl: '',
  openDoorUser: '',
  openDoorPassword: '',
  openDoorNum: '1',
  /** Uma linha JSON por requisição ao bridge (ajuste de integração com o XPE). */
  logInboundRequests: true,
  /** IP LAN deste PC (detectado automaticamente). */
  preferredLanIp: '',
};

const DEFAULT_XPE_INTEGRATION = {
  deviceUrl: '',
  deviceIp: '',
  devicePort: 80,
  deviceWebUser: '',
  setupCompletedAt: '',
  lastProbeAt: '',
  lastProbeOk: false,
  lastProbeSummary: '',
};

const DEFAULT_DEVICE_SETTINGS_FILE = {
  clubName: 'Clube Atlético Marítimo',
  systemName: 'AquaAccess',
  clubDisplayName: 'AquaAccess',
  deviceName: 'Intelbras XPE 3200 PLUS IP',
  locationLabel: 'Catraca principal',
  ip: '',
  devicePort: '80',
  firmware: '',
  defaultExamValidityDays: 30,
  examAllowedWeekdays: [1, 2, 3, 4, 5],
  autoSync5Min: true,
  blockExpiredExams: true,
  notify5DaysBefore: true,
  notifyDeniedAccess: true,
  dailyEmailSummary: false,
  colorTheme: 'dark',
};

let xpeBridgeHandle = null;
let lastXpeBridgeStartError = null;
let lastXpeExportDir = null;
let xpeSyncBusy = false;

let mainWindow;

function checkDeviceTcpConnection(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const safeHost = String(host || '').trim();
    const safePort = Number(port);
    if (!safeHost || !Number.isInteger(safePort) || safePort < 1 || safePort > 65535) {
      resolve({ ok: false, error: 'IP/porta inválidos.' });
      return;
    }

    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(Math.max(500, Number(timeoutMs) || 2500));
    socket.once('connect', () => {
      finish({ ok: true });
    });
    socket.once('timeout', () => {
      finish({ ok: false, error: 'Tempo de conexão esgotado.' });
    });
    socket.once('error', (err) => {
      const msg = String(err?.message || 'Falha de rede.');
      finish({ ok: false, error: msg });
    });

    try {
      socket.connect(safePort, safeHost);
    } catch (err) {
      finish({ ok: false, error: String(err?.message || 'Falha ao iniciar conexão.') });
    }
  });
}

function userDataPath() {
  return app.getPath('userData');
}

function xpeBridgeSettingsPath() {
  return path.join(userDataPath(), 'xpe-bridge-settings.json');
}

function xpeIntegrationPath() {
  return path.join(userDataPath(), 'xpe-integration.json');
}

function deviceSettingsPath() {
  return path.join(userDataPath(), 'device-settings.json');
}

function loadXpeIntegration() {
  try {
    const p = xpeIntegrationPath();
    if (fs.existsSync(p)) {
      return { ...DEFAULT_XPE_INTEGRATION, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_XPE_INTEGRATION };
}

function saveXpeIntegration(patch) {
  const next = { ...loadXpeIntegration(), ...patch };
  fs.writeFileSync(xpeIntegrationPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function loadDeviceSettingsFile() {
  try {
    const p = deviceSettingsPath();
    if (fs.existsSync(p)) {
      return { ...DEFAULT_DEVICE_SETTINGS_FILE, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_DEVICE_SETTINGS_FILE };
}

function saveDeviceSettingsFile(settings) {
  const next = { ...DEFAULT_DEVICE_SETTINGS_FILE, ...settings };
  fs.writeFileSync(deviceSettingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

async function runStartupXpeAutoDiscover() {
  const integration = loadXpeIntegration();
  const bridgeCur = loadXpeBridgeSettings();
  const deviceHost =
    integration.deviceIp || loadDeviceSettingsFile().ip || '';
  const net = getLocalNetworkInfo({
    deviceHost,
    savedLanIp: bridgeCur.preferredLanIp,
  });
  const bridgePatch = {};

  const resolvedLan = resolveLanIpForBridge(deviceHost, bridgeCur.preferredLanIp);
  if (resolvedLan && !String(bridgeCur.preferredLanIp || '').trim()) {
    bridgePatch.preferredLanIp = resolvedLan;
  }

  let deviceUrl =
    String(integration.deviceUrl || '').trim() ||
    (integration.deviceIp
      ? `http://${integration.deviceIp}:${integration.devicePort || 80}`
      : '');

  const devFile = loadDeviceSettingsFile();
  if (!deviceUrl && devFile.ip) {
    const port = Number(devFile.devicePort) || 80;
    deviceUrl = `http://${devFile.ip}:${port}`;
  }

  let probeResult = null;
  if (deviceUrl) {
    const parsed = parseIntelbrasDeviceUrl(deviceUrl);
    if (parsed.ok) {
      probeResult = await probeIntelbrasDevice({
        host: parsed.host,
        port: parsed.port,
        baseUrl: parsed.baseUrl,
      });
      saveXpeIntegration({
        deviceUrl: parsed.baseUrl,
        deviceIp: parsed.host,
        devicePort: parsed.port,
        lastProbeAt: new Date().toISOString(),
        lastProbeOk: Boolean(probeResult.ok),
        lastProbeSummary: probeResult.summary,
      });
      if (!String(bridgeCur.openDoorBaseUrl || '').trim()) {
        bridgePatch.openDoorBaseUrl = parsed.baseUrl;
      }
    }
  }

  if (Object.keys(bridgePatch).length) {
    const merged = { ...bridgeCur, ...bridgePatch };
    fs.writeFileSync(xpeBridgeSettingsPath(), JSON.stringify(merged, null, 2), 'utf8');
  }

  if (!app.isPackaged) {
    console.log('[xpe-setup] LAN', net.preferredLanIp || '—', probeResult?.summary || 'sem probe');
  }
}

function loadXpeBridgeSettings() {
  try {
    const p = xpeBridgeSettingsPath();
    if (fs.existsSync(p)) {
      const o = JSON.parse(fs.readFileSync(p, 'utf8'));
      return { ...DEFAULT_XPE_BRIDGE_SETTINGS, ...o };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_XPE_BRIDGE_SETTINGS };
}

const XPE_INBOUND_LOG_MAX_BYTES = 480 * 1024;

function xpeInboundLogPath() {
  return path.join(userDataPath(), 'xpe-bridge-inbound.ndjson');
}

function appendInboundBridgeRecord(rec) {
  const cfg = loadXpeBridgeSettings();
  if (!cfg.logInboundRequests) return;
  try {
    const p = xpeInboundLogPath();
    fs.appendFileSync(p, `${JSON.stringify(rec)}\n`, 'utf8');
    const st = fs.statSync(p);
    if (st.size > XPE_INBOUND_LOG_MAX_BYTES) {
      const raw = fs.readFileSync(p, 'utf8');
      const lines = raw.split('\n').filter((l) => l.trim());
      const tail = lines.slice(-150);
      fs.writeFileSync(p, `${tail.join('\n')}\n`, 'utf8');
    }
  } catch (err) {
    console.error('[xpe-bridge-inbound]', err);
  }
}

async function stopXpeBridgeServer() {
  if (xpeBridgeHandle) {
    try {
      await xpeBridgeHandle.stop();
    } catch {
      /* ignore */
    }
    xpeBridgeHandle = null;
  }
}

async function restartXpeBridgeServer() {
  await stopXpeBridgeServer();
  lastXpeBridgeStartError = null;
  const cfg = loadXpeBridgeSettings();
  if (!cfg.enabled) return;
  const port = Number(cfg.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    lastXpeBridgeStartError = 'Porta HTTP inválida (use 1–65535).';
    return;
  }
  try {
    xpeBridgeHandle = await startXpeBridge({
      port,
      host: String(cfg.host || '0.0.0.0').trim() || '0.0.0.0',
      path: String(cfg.path || '/intelbras/xpe').trim() || '/intelbras/xpe',
      sharedSecret: String(cfg.sharedSecret || '').trim(),
      getDoorConfig: () => {
        const c = loadXpeBridgeSettings();
        return {
          openDoorWhenGranted: Boolean(c.openDoorWhenGranted),
          openDoorBaseUrl: String(c.openDoorBaseUrl || '').trim().replace(/\/+$/, ''),
          openDoorUser: String(c.openDoorUser || ''),
          openDoorPassword: String(c.openDoorPassword || ''),
          openDoorNum: String(c.openDoorNum != null ? c.openDoorNum : '1'),
        };
      },
      log: (line) => {
        if (!app.isPackaged) {
          console.log(line);
        }
      },
      recordInbound: (rec) => {
        appendInboundBridgeRecord(rec);
      },
      onAccess: async (userRef) => {
        const pid = findPatientIdForXpeBridge(userRef);
        if (!pid) {
          return { granted: false, unknown: true };
        }
        const loc = 'Intelbras XPE · Log de acesso (HTTP)';
        const r = registerPoolAccess(pid, loc);
        return { granted: Boolean(r.granted), unknown: false };
      },
    });
  } catch (e) {
    lastXpeBridgeStartError = String(e?.message || e);
    console.error('[xpe-bridge] falha ao iniciar:', e);
    xpeBridgeHandle = null;
  }
}

function deleteFileIfExists(relativePath) {
  if (!relativePath || typeof relativePath !== 'string') {
    return;
  }
  const safe = relativePath.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  const full = path.join(userDataPath(), safe);
  try {
    if (fs.existsSync(full)) {
      fs.unlinkSync(full);
    }
  } catch {
    /* ignore */
  }
}

function isValidPhotoDataUrl(photoBase64) {
  return (
    typeof photoBase64 === 'string' &&
    /^data:image\/(png|jpeg|jpg|webp);base64,.+/i.test(photoBase64)
  );
}

function saveNewPatientPhoto(patientId, photoBase64) {
  const match = String(photoBase64).match(/^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i);
  if (!match) {
    return null;
  }
  let ext = match[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  const buf = Buffer.from(match[2], 'base64');
  const dir = path.join(userDataPath(), 'patient-photos');
  fs.mkdirSync(dir, { recursive: true });
  const rel = path.join('patient-photos', `${patientId}.${ext}`).replace(/\\/g, '/');
  const full = path.join(userDataPath(), rel);
  fs.writeFileSync(full, buf);
  return rel;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: '',
    width: 1024,
    height: 680,
    minWidth: 800,
    minHeight: 520,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault();
    mainWindow.setTitle('');
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'login', 'login.html'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  await initDb();
  await runStartupXpeAutoDiscover();
  await restartXpeBridgeServer();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (xpeBridgeHandle?.server) {
    try {
      xpeBridgeHandle.server.close();
    } catch {
      /* ignore */
    }
  }
  xpeBridgeHandle = null;
});

ipcMain.handle('login', async (_event, { username, password }) => {
  return authenticateUser(String(username || '').trim(), String(password || ''));
});

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('to-file-url', (_event, relativePath) => {
  if (!relativePath || typeof relativePath !== 'string') {
    return '';
  }
  const safe = relativePath.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  const full = path.join(app.getPath('userData'), safe);
  if (!fs.existsSync(full)) {
    return '';
  }
  return pathToFileURL(full).href;
});

ipcMain.handle('read-renderer-file', (_event, relativePath) => {
  if (!relativePath || typeof relativePath !== 'string') {
    return '';
  }
  const raw = relativePath.replace(/^[/\\]+/, '').replace(/\.\./g, '');
  const base = path.resolve(path.join(__dirname, 'renderer'));
  const full = path.resolve(path.join(base, raw));
  const relToBase = path.relative(base, full);
  if (relToBase.startsWith('..') || path.isAbsolute(relToBase)) {
    return '';
  }
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return '';
  }
});

ipcMain.handle('patients-create', async (_event, payload) => {
  const { fullName, cpf, phone, photoBase64, syncToXpe } = payload || {};
  if (!isValidPhotoDataUrl(photoBase64)) {
    return { ok: false, error: 'É obrigatório enviar a foto do paciente.' };
  }
  const result = createPatient(fullName, cpf, phone);
  if (!result.ok) {
    return result;
  }
  const rel = saveNewPatientPhoto(result.id, photoBase64);
  if (!rel) {
    deletePatientById(result.id);
    return { ok: false, error: 'Foto inválida. Use PNG, JPG ou WebP.' };
  }
  setPatientPhotoPath(result.id, rel);

  const patient = getPatientById(result.id);
  let xpeSync = { ok: false, skipped: true, error: 'Envio ao XPE não solicitado.' };
  const shouldSync = syncToXpe !== false;
  if (shouldSync) {
    const creds = resolveXpeWebCredentials({});
    if (!creds.ip || !creds.username || !creds.password) {
      xpeSync = {
        ok: false,
        skipped: true,
        error:
          'Paciente salvo no AquaAccess, mas o XPE não está completo em Configurações (IP + usuário + senha web).',
      };
    } else {
      try {
        console.log('[xpe] auto-sync após cadastro, paciente', result.id);
        xpeSync = await syncUserToXPE(patient, {
          ...creds,
          userDataPath: userDataPath(),
          headless: true,
          slowMo: 150,
        });
      } catch (e) {
        xpeSync = { ok: false, error: String(e?.message || e) };
      }
    }
  }

  return { ok: true, id: result.id, xpeSync };
});

ipcMain.handle('patients-update', async (_event, payload) => {
  const { id, fullName, cpf, phone, photoBase64 } = payload || {};
  const existing = getPatientById(id);
  if (!existing) {
    return { ok: false, error: 'Paciente não encontrado.' };
  }
  const hasNewPhoto = isValidPhotoDataUrl(photoBase64);
  const result = updatePatient(id, fullName, cpf, phone);
  if (!result.ok) {
    return result;
  }
  if (hasNewPhoto) {
    const rel = saveNewPatientPhoto(Number(id), photoBase64);
    if (!rel) {
      return { ok: false, error: 'Não foi possível salvar a nova foto.' };
    }
    if (existing.photo_path) {
      deleteFileIfExists(String(existing.photo_path));
    }
    setPatientPhotoPath(Number(id), rel);
  }
  return { ok: true, id: Number(id) };
});

ipcMain.handle(
  'exams-register',
  (_event, { patientId, examDate, validityDays, allowedWeekdays } = {}) =>
    createExam(patientId, examDate, { validityDays, allowedWeekdays })
);

ipcMain.handle('patients-search', (_event, { query, limit } = {}) =>
  searchPatientsByName(query, limit)
);

ipcMain.handle('patients-get', (_event, id) => getPatientById(id));

ipcMain.handle('patients-cpf-lookup', (_event, { cpf } = {}) => findPatientIdByCpf(cpf));

ipcMain.handle('patients-list', () => listPatients());

ipcMain.handle('patients-list-overview', () => listPatientsOverview());

ipcMain.handle('patients-set-blocked', (_event, { id, blocked } = {}) =>
  setPatientBlocked(id, Boolean(blocked))
);

ipcMain.handle('patients-delete', async (_event, { id } = {}) => {
  const existing = getPatientById(id);
  if (!existing) {
    return { ok: false, error: 'Paciente não encontrado.' };
  }
  const photoPath = existing.photo_path ? String(existing.photo_path) : null;
  const result = removePatient(id);
  if (!result.ok) {
    return result;
  }
  if (photoPath) {
    deleteFileIfExists(photoPath);
  }
  return { ok: true };
});

ipcMain.handle('exams-list', () => listExamsDone());

ipcMain.handle('exams-delete', (_event, { id } = {}) => deleteExamById(id));

ipcMain.handle('access-register-pool', (_event, { patientId, location } = {}) =>
  registerPoolAccess(patientId, location)
);

ipcMain.handle('access-list', (_event, { limit } = {}) => listAccessEvents(limit));

ipcMain.handle('access-stats-today', () => accessStatsToday());

ipcMain.handle('reports-summary', (_e, { periodStart, periodEnd } = {}) =>
  adminReportsSummary(periodStart, periodEnd)
);

ipcMain.handle('reports-rows', (_e, { kind, periodStart, periodEnd } = {}) =>
  adminReportsRows(kind, periodStart, periodEnd)
);

ipcMain.handle('local-db-stats', () => {
  try {
    return { ok: true, ...getLocalDbStats() };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('device-connectivity-check', async (_event, { ip, port, timeoutMs } = {}) => {
  return checkDeviceTcpConnection(ip, port, timeoutMs);
});

ipcMain.handle('dashboard-snapshot', () => {
  try {
    return { ok: true, data: dashboardSnapshot() };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('xpe-bridge-get-settings', () => {
  const s = loadXpeBridgeSettings();
  const integration = loadXpeIntegration();
  const deviceHost = integration.deviceIp || loadDeviceSettingsFile().ip || '';
  const net = getLocalNetworkInfo({ deviceHost, savedLanIp: s.preferredLanIp });
  const lan = resolveLanIpForBridge(deviceHost, s.preferredLanIp);
  const actionUrl = buildActionUrlLogAccess({
    lanIp: lan,
    bridgePort: s.port,
    bridgePath: s.path,
  });
  return {
    ok: true,
    ...s,
    openDoorPassword: '',
    hasOpenDoorPassword: Boolean(String(s.openDoorPassword || '').length),
    sharedSecret: '',
    hasSharedSecret: Boolean(String(s.sharedSecret || '').length),
    detectedLanIp: net.autoDetectedLanIp || net.preferredLanIp,
    pcLanIp: lan,
    actionUrlLogAccess: actionUrl,
    actionUrlExample: actionUrl ? `${actionUrl}?userId=1` : '',
  };
});

ipcMain.handle('xpe-bridge-set-settings', async (_e, payload = {}) => {
  const cur = loadXpeBridgeSettings();
  const portNum = Number(payload.port);
  const port = Number.isInteger(portNum) && portNum >= 1 && portNum <= 65535 ? portNum : cur.port;
  let sharedSecret = cur.sharedSecret;
  if (payload.sharedSecret != null && String(payload.sharedSecret).trim() !== '') {
    sharedSecret = String(payload.sharedSecret).trim();
  }
  let openDoorPassword = cur.openDoorPassword;
  if (payload.openDoorPassword != null && String(payload.openDoorPassword).length > 0) {
    openDoorPassword = String(payload.openDoorPassword);
  }
  let pathNorm = String(payload.path || cur.path || '/intelbras/xpe').trim() || '/intelbras/xpe';
  if (!pathNorm.startsWith('/')) pathNorm = `/${pathNorm}`;

  const next = {
    ...cur,
    enabled: Boolean(payload.enabled),
    port,
    host: String(payload.host || cur.host || '0.0.0.0').trim() || '0.0.0.0',
    path: pathNorm,
    sharedSecret,
    openDoorWhenGranted: Boolean(payload.openDoorWhenGranted),
    openDoorBaseUrl: String(payload.openDoorBaseUrl ?? cur.openDoorBaseUrl ?? '').trim(),
    openDoorUser: String(payload.openDoorUser ?? cur.openDoorUser ?? ''),
    openDoorPassword,
    openDoorNum: String(payload.openDoorNum ?? cur.openDoorNum ?? '1'),
    logInboundRequests:
      payload.logInboundRequests == null ? Boolean(cur.logInboundRequests) : Boolean(payload.logInboundRequests),
    preferredLanIp:
      payload.preferredLanIp != null
        ? String(payload.preferredLanIp).trim()
        : String(cur.preferredLanIp || '').trim(),
  };
  fs.writeFileSync(xpeBridgeSettingsPath(), JSON.stringify(next, null, 2), 'utf8');
  await restartXpeBridgeServer();
  const listening = Boolean(xpeBridgeHandle);
  if (next.enabled && !listening) {
    return {
      ok: false,
      bridgeStartError: lastXpeBridgeStartError || 'Não foi possível escutar na porta (em uso ou bloqueada pelo firewall?).',
      enabled: next.enabled,
      port: next.port,
      host: next.host,
      path: next.path,
      openDoorWhenGranted: next.openDoorWhenGranted,
      openDoorBaseUrl: next.openDoorBaseUrl,
      openDoorUser: next.openDoorUser,
      openDoorNum: next.openDoorNum,
      hasOpenDoorPassword: Boolean(String(next.openDoorPassword || '').length),
      hasSharedSecret: Boolean(String(next.sharedSecret || '').length),
      logInboundRequests: next.logInboundRequests,
    };
  }
  return {
    ok: true,
    enabled: next.enabled,
    port: next.port,
    host: next.host,
    path: next.path,
    openDoorWhenGranted: next.openDoorWhenGranted,
    openDoorBaseUrl: next.openDoorBaseUrl,
    openDoorUser: next.openDoorUser,
    openDoorNum: next.openDoorNum,
    hasOpenDoorPassword: Boolean(String(next.openDoorPassword || '').length),
    hasSharedSecret: Boolean(String(next.sharedSecret || '').length),
    logInboundRequests: next.logInboundRequests,
  };
});

ipcMain.handle('xpe-bridge-get-status', async () => {
  const cfg = loadXpeBridgeSettings();
  const integration = loadXpeIntegration();
  const deviceHost = integration.deviceIp || loadDeviceSettingsFile().ip || '';
  const lan = resolveLanIpForBridge(deviceHost, cfg.preferredLanIp);
  return {
    ok: true,
    enabled: cfg.enabled,
    listening: Boolean(xpeBridgeHandle),
    port: cfg.port,
    path: cfg.path,
    host: cfg.host,
    lastStartError: lastXpeBridgeStartError,
    pcLanIp: lan,
    actionUrlLogAccess: buildActionUrlLogAccess({
      lanIp: lan,
      bridgePort: cfg.port,
      bridgePath: cfg.path,
    }),
  };
});

ipcMain.handle('xpe-export-user-pack', async () => {
  try {
    const rows = listPatients();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(userDataPath(), 'xpe-export', stamp);
    fs.mkdirSync(dir, { recursive: true });
    const lines = ['patient_id;full_name;cpf;photo_filename;xpe_hint'];
    let copied = 0;
    for (const p of rows) {
      const rel = p.photo_path ? String(p.photo_path).trim() : '';
      const full = rel ? path.join(userDataPath(), rel.replace(/^[/\\]+/, '').replace(/\.\./g, '')) : '';
      let photoFn = '';
      if (rel && fs.existsSync(full)) {
        let ext = path.extname(rel).toLowerCase().replace('.', '') || 'jpg';
        if (ext === 'jpeg') ext = 'jpg';
        if (!['jpg', 'png', 'webp'].includes(ext)) ext = 'jpg';
        photoFn = `patient-${p.id}.${ext}`;
        fs.copyFileSync(full, path.join(dir, photoFn));
        copied += 1;
      }
      const name = String(p.full_name || '').replace(/;/g, ',');
      const cpf = String(p.cpf || '');
      lines.push(
        `${p.id};${name};${cpf};${photoFn};Use ID Usuário ${p.id} no XPE (ou CPF 11 dígitos no bridge)`
      );
    }
    const readme = [
      'Exportação AquaAccess — Intelbras XPE 3200 PLUS IP',
      '',
      '1. Cada linha do CSV corresponde a um paciente. A coluna patient_id é o ID interno do AquaAccess.',
      '2. No XPE (Controle de Acesso > Usuários), cadastre o mesmo número em "ID Usuário" que o patient_id,',
      '   para que o Log de Acesso HTTP enviado ao PC identifique o associado.',
      '3. Anexe a foto na interface web do XPE (cadastro por arquivo), usando o arquivo patient-<id>.* desta pasta.',
      '   Consulte o manual do modelo para formatos aceitos e boas práticas de iluminação.',
      '',
      `Resumo: ${rows.length} paciente(s), ${copied} foto(s) copiada(s).`,
    ].join('\r\n');
    fs.writeFileSync(path.join(dir, 'LEIA-ME.txt'), readme, 'utf8');
    fs.writeFileSync(path.join(dir, 'aquaaccess-manifest.csv'), `\uFEFF${lines.join('\r\n')}`, 'utf8');
    lastXpeExportDir = dir;
    return { ok: true, folder: dir, patientCount: rows.length, photosCopied: copied };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
});

ipcMain.handle('xpe-export-open-last-folder', async () => {
  if (!lastXpeExportDir || !fs.existsSync(lastXpeExportDir)) {
    return { ok: false, error: 'Nenhuma exportação nesta sessão.' };
  }
  const err = await shell.openPath(lastXpeExportDir);
  if (err) {
    return { ok: false, error: err };
  }
  return { ok: true, folder: lastXpeExportDir };
});

ipcMain.handle('xpe-bridge-inbound-log-path', () => ({
  ok: true,
  path: xpeInboundLogPath(),
}));

ipcMain.handle('device-settings-get', () => ({
  ok: true,
  settings: loadDeviceSettingsFile(),
}));

ipcMain.handle('device-settings-set', (_e, payload = {}) => {
  const cur = loadDeviceSettingsFile();
  const next = saveDeviceSettingsFile({ ...cur, ...payload });
  if (next.ip) {
    const port = Number(next.devicePort) || 80;
    saveXpeIntegration({
      deviceUrl: `http://${next.ip}:${port}`,
      deviceIp: next.ip,
      devicePort: port,
    });
  }
  return { ok: true, settings: next };
});

ipcMain.handle('xpe-setup-discover', async (_e, payload = {}) => {
  const integration = loadXpeIntegration();
  const bridge = loadXpeBridgeSettings();
  const device = loadDeviceSettingsFile();
  const status = {
    enabled: bridge.enabled,
    listening: Boolean(xpeBridgeHandle),
    port: bridge.port,
    path: bridge.path,
    lastStartError: lastXpeBridgeStartError,
  };

  let deviceUrl =
    String(payload.deviceUrl || '').trim() || String(integration.deviceUrl || '').trim();
  if (!deviceUrl && device.ip) {
    deviceUrl = `http://${device.ip}:${Number(device.devicePort) || 80}`;
  }

  let deviceHost = integration.deviceIp || device.ip || '';
  let probe = null;
  if (deviceUrl) {
    const parsed = parseIntelbrasDeviceUrl(deviceUrl);
    if (parsed.ok) {
      deviceHost = parsed.host;
      probe = await probeIntelbrasDevice({
        host: parsed.host,
        port: parsed.port,
        baseUrl: parsed.baseUrl,
      });
    }
  }

  const net = getLocalNetworkInfo({
    deviceHost,
    savedLanIp: bridge.preferredLanIp,
  });
  const lanIp = resolveLanIpForBridge(deviceHost, bridge.preferredLanIp);
  const actionUrl = buildActionUrlLogAccess({
    lanIp,
    bridgePort: bridge.port,
    bridgePath: bridge.path,
  });

  return {
    ok: true,
    network: net,
    pcLanIp: lanIp,
    integration,
    deviceSettings: device,
    bridge: {
      enabled: bridge.enabled,
      port: bridge.port,
      path: bridge.path,
      preferredLanIp: bridge.preferredLanIp || lanIp,
    },
    bridgeStatus: status,
    probe,
    actionUrlLogAccess: actionUrl,
    actionUrlExample: actionUrl ? `${actionUrl}?userId=1` : '',
    setupComplete: Boolean(integration.setupCompletedAt),
  };
});

ipcMain.handle('xpe-setup-apply', async (_e, payload = {}) => {
  const deviceUrl = String(payload.deviceUrl || '').trim();
  if (!deviceUrl) {
    return { ok: false, error: 'Informe a URL do Intelbras (ex.: http://192.168.0.67).' };
  }

  const bridgeCur = loadXpeBridgeSettings();
  const parsedEarly = parseIntelbrasDeviceUrl(deviceUrl);
  const deviceHostEarly = parsedEarly.ok ? parsedEarly.host : '';
  const manualLan = normalizeIpv4Loose(String(payload.lanIp || '').trim());
  const lanIp =
    manualLan ||
    resolveLanIpForBridge(deviceHostEarly, bridgeCur.preferredLanIp) ||
    null;
  const bridgePort =
    Number(payload.bridgePort) ||
    Number(bridgeCur.port) ||
    DEFAULT_BRIDGE_PORT;
  const bridgePath = payload.bridgePath || bridgeCur.path || '/intelbras/xpe';
  const webUser = String(payload.webUser || '').trim();
  const webPassword =
    payload.webPassword != null ? String(payload.webPassword) : '';

  const parsed = parseIntelbrasDeviceUrl(deviceUrl);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const probe = await probeIntelbrasDevice({
    host: parsed.host,
    port: parsed.port,
    baseUrl: parsed.baseUrl,
  });

  const plan = buildSetupPlan({
    deviceUrl: parsed.baseUrl,
    lanIp,
    bridgePort,
    bridgePath,
    webUser,
    probe,
  });
  if (!plan.ok) {
    return { ok: false, error: plan.error };
  }

  const devSettings = loadDeviceSettingsFile();
  saveDeviceSettingsFile({
    ...devSettings,
    ip: plan.device.ip,
    devicePort: String(plan.device.port),
  });

  saveXpeIntegration({
    deviceUrl: plan.device.baseUrl,
    deviceIp: plan.device.ip,
    devicePort: plan.device.port,
    deviceWebUser: webUser,
    setupCompletedAt: new Date().toISOString(),
    lastProbeAt: new Date().toISOString(),
    lastProbeOk: Boolean(probe.ok),
    lastProbeSummary: probe.summary,
  });

  const bridgeNext = {
    ...bridgeCur,
    enabled: true,
    port: plan.bridge.port,
    path: plan.bridge.path,
    host: plan.bridge.host,
    logInboundRequests: true,
    preferredLanIp: lanIp || bridgeCur.preferredLanIp || '',
    openDoorBaseUrl: plan.bridge.openDoorBaseUrl,
    openDoorUser: plan.bridge.openDoorUser || bridgeCur.openDoorUser,
    openDoorWhenGranted: bridgeCur.openDoorWhenGranted,
  };
  if (webPassword) {
    bridgeNext.openDoorPassword = webPassword;
  }

  fs.writeFileSync(xpeBridgeSettingsPath(), JSON.stringify(bridgeNext, null, 2), 'utf8');
  await restartXpeBridgeServer();

  const listening = Boolean(xpeBridgeHandle);
  return {
    ok: true,
    probe,
    plan,
    pcLanIp: lanIp,
    deviceSettings: {
      ip: plan.device.ip,
      devicePort: String(plan.device.port),
    },
    bridge: {
      enabled: bridgeNext.enabled,
      port: bridgeNext.port,
      path: bridgeNext.path,
      listening,
      bridgeStartError: listening ? null : lastXpeBridgeStartError,
      openDoorBaseUrl: bridgeNext.openDoorBaseUrl,
      openDoorUser: bridgeNext.openDoorUser,
      hasOpenDoorPassword: Boolean(String(bridgeNext.openDoorPassword || '').length),
    },
    actionUrlLogAccess: plan.actionUrlLogAccess,
    actionUrlExample: plan.actionUrlExample,
    instructions: plan.instructions,
    missing: plan.missing,
  };
});

ipcMain.handle('xpe-bridge-open-inbound-log', async () => {
  const p = xpeInboundLogPath();
  try {
    if (!fs.existsSync(p)) {
      fs.writeFileSync(p, '', 'utf8');
    }
  } catch {
    /* ignore */
  }
  const err = await shell.openPath(p);
  if (err) {
    return { ok: false, path: p, error: err };
  }
  return { ok: true, path: p };
});

function resolveXpeWebCredentials(payload = {}) {
  const bridge = loadXpeBridgeSettings();
  const device = loadDeviceSettingsFile();

  let ip = String(payload.ip || '').trim();
  let port = payload.port != null ? Number(payload.port) : null;

  if (!ip && bridge.openDoorBaseUrl) {
    try {
      const u = new URL(String(bridge.openDoorBaseUrl).trim());
      ip = u.hostname || '';
      if (port == null && u.port) port = Number(u.port);
      if (port == null && u.protocol === 'https:') port = 443;
      if (port == null && u.protocol === 'http:') port = 80;
    } catch {
      /* ignore */
    }
  }

  if (!ip) {
    ip = String(device.ip || '').trim();
  }
  if (port == null || !Number.isFinite(port)) {
    const fromDevice = Number(device.devicePort);
    const p = Number.isFinite(fromDevice) && fromDevice >= 1 ? fromDevice : Number(payload.port);
    port = Number.isFinite(p) && p >= 1 && p <= 65535 ? p : 80;
  }

  let username = String(payload.username || '').trim();
  let password = payload.password != null ? String(payload.password) : '';

  if (!username) username = String(bridge.openDoorUser || '').trim();
  if (!password) password = String(bridge.openDoorPassword || '');

  return { ip, port, username, password };
}

ipcMain.handle('xpe-sync-user', async (_event, payload = {}) => {
  if (xpeSyncBusy) {
    return { ok: false, error: 'Sincronização XPE já em andamento.' };
  }

  const patientId = Number(payload.patientId ?? payload.id);
  if (!Number.isInteger(patientId) || patientId < 1) {
    return { ok: false, error: 'ID do paciente inválido.' };
  }

  const patient = getPatientById(patientId);
  if (!patient) {
    return { ok: false, error: 'Paciente não encontrado.' };
  }

  const creds = resolveXpeWebCredentials(payload);
  if (!creds.ip) {
    return {
      ok: false,
      error: 'IP do XPE não configurado. Abra Configurações → Conexão Intelbras e salve o IP/URL.',
    };
  }
  if (!creds.username) {
    return {
      ok: false,
      error: 'Usuário web do XPE não configurado. Preencha em Configurações → Conexão Intelbras.',
    };
  }
  if (!creds.password) {
    return {
      ok: false,
      error:
        'Senha web do XPE não salva. Em Configurações → Conexão Intelbras digite a senha e clique em Salvar alterações.',
    };
  }

  xpeSyncBusy = true;
  try {
    console.log('[xpe] IPC xpe-sync-user: paciente', patientId, 'ip', creds.ip);
    const result = await syncUserToXPE(patient, {
      ...creds,
      userDataPath: userDataPath(),
    });
    return result;
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    xpeSyncBusy = false;
  }
});
