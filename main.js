const fs = require('fs');
const { pathToFileURL } = require('url');
const { app, BrowserWindow, ipcMain, Menu } = require('electron');

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
} = require('./db');

let mainWindow;

function userDataPath() {
  return app.getPath('userData');
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
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
  const { fullName, cpf, phone, photoBase64 } = payload || {};
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
  return { ok: true, id: result.id };
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

ipcMain.handle('exams-register', (_event, { patientId, examDate } = {}) =>
  createExam(patientId, examDate)
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
