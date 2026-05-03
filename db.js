const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { app } = require('electron');

let db;
let dbPath;

function persist() {
  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

async function initDb() {
  const initSqlJs = require('sql.js');
  dbPath = path.join(app.getPath('userData'), 'club-piscinas.db');

  const SQL = await initSqlJs({
    locateFile: (file) =>
      path.join(__dirname, 'node_modules', 'sql.js', 'dist', file),
  });

  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      cpf TEXT NOT NULL UNIQUE,
      phone TEXT,
      photo_path TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS exams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      exam_date TEXT,
      valid_until TEXT,
      status TEXT DEFAULT 'realizado',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS access_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      granted INTEGER NOT NULL,
      location TEXT NOT NULL DEFAULT 'Catraca principal · Piscina',
      created_at TEXT NOT NULL,
      FOREIGN KEY (patient_id) REFERENCES patients(id)
    );
  `);

  const countRows = db.exec('SELECT COUNT(*) AS c FROM users');
  const count = countRows[0]?.values[0]?.[0] ?? 0;
  if (count === 0) {
    const hash = bcrypt.hashSync('admin', 10);
    db.run('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
    persist();
  }

  try {
    db.run('ALTER TABLE patients ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0');
    persist();
  } catch {
    /* coluna já existe */
  }

  try {
    db.run('ALTER TABLE users ADD COLUMN display_name TEXT');
    persist();
  } catch {
    /* coluna já existe */
  }
  try {
    db.run('ALTER TABLE users ADD COLUMN email TEXT');
    persist();
  } catch {
    /* coluna já existe */
  }
  try {
    db.run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'medico'");
    persist();
  } catch {
    /* coluna já existe */
  }
  try {
    db.run('ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1');
    persist();
  } catch {
    /* coluna já existe */
  }

  db.run(`UPDATE users SET role = 'admin' WHERE lower(username) = 'admin'`);
  db.run(
    `UPDATE users SET display_name = 'Administrador' WHERE lower(username) = 'admin' AND (display_name IS NULL OR trim(display_name) = '')`
  );

  const medicoExists = db.exec(`SELECT 1 FROM users WHERE lower(username) = 'medico'`);
  if (!medicoExists[0]?.values?.length) {
    const medicoHash = bcrypt.hashSync('admin', 10);
    db.run(
      `INSERT INTO users (username, password_hash, role, display_name, active) VALUES ('medico', ?, 'medico', 'Médico', 1)`,
      [medicoHash]
    );
  }
  persist();
}

function authenticateUser(username, password) {
  const u = String(username || '').trim();
  if (!u || !password) {
    return { ok: false, error: 'Informe usuário e senha.' };
  }
  const stmt = db.prepare(
    'SELECT id, username, password_hash, role, display_name, email, active FROM users WHERE username = ?'
  );
  stmt.bind([u]);
  if (!stmt.step()) {
    stmt.free();
    return { ok: false, error: 'Usuário ou senha inválidos.' };
  }
  const row = stmt.getAsObject();
  stmt.free();
  if (!bcrypt.compareSync(password, row.password_hash)) {
    return { ok: false, error: 'Usuário ou senha inválidos.' };
  }
  if (!Number(row.active)) {
    return {
      ok: false,
      error: 'Usuário desativado. Solicite reativação ao administrador.',
    };
  }
  const roleRaw = String(row.role || 'medico').toLowerCase();
  const role = roleRaw === 'admin' ? 'admin' : 'medico';
  return {
    ok: true,
    id: row.id,
    username: row.username,
    role,
    displayName: row.display_name ? String(row.display_name).trim() : String(row.username),
    email: row.email ? String(row.email).trim() : '',
  };
}

function listSystemUsers() {
  const stmt = db.prepare(
    `SELECT id, username, display_name, email, role, active, created_at
     FROM users
     ORDER BY lower(role) DESC, datetime(created_at) ASC`
  );
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    display_name: r.display_name ? String(r.display_name).trim() : '',
    email: r.email ? String(r.email).trim() : '',
    role: String(r.role || 'medico').toLowerCase() === 'admin' ? 'admin' : 'medico',
    active: Boolean(Number(r.active)),
    created_at: r.created_at,
  }));
}

function getSystemUserRowById(id) {
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  const stmt = db.prepare(
    'SELECT id, username, password_hash, role, display_name, email, active FROM users WHERE id = ?'
  );
  stmt.bind([pid]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return row;
}

function createSystemUser(payload) {
  const username = String(payload?.username || '').trim().toLowerCase();
  const password = String(payload?.password || '');
  const displayName = String(payload?.displayName || '').trim();
  const email = String(payload?.email || '').trim();
  const roleRaw = String(payload?.role || 'medico').toLowerCase();
  const role = roleRaw === 'admin' ? 'admin' : 'medico';

  if (!username || !/^[a-z0-9._-]+$/.test(username)) {
    return { ok: false, error: 'Usuário inválido (use letras minúsculas, números, ponto, _ ou -).' };
  }
  if (username.length > 64) {
    return { ok: false, error: 'Usuário muito longo.' };
  }
  if (password.length < 4) {
    return { ok: false, error: 'A senha deve ter pelo menos 4 caracteres.' };
  }
  if (!displayName) {
    return { ok: false, error: 'Informe o nome para exibição.' };
  }

  const chk = db.prepare('SELECT id FROM users WHERE lower(username) = lower(?)');
  chk.bind([username]);
  if (chk.step()) {
    chk.free();
    return { ok: false, error: 'Este nome de usuário já existe.' };
  }
  chk.free();

  const hash = bcrypt.hashSync(password, 10);
  try {
    db.run(
      `INSERT INTO users (username, password_hash, display_name, email, role, active)
       VALUES (?, ?, ?, ?, ?, 1)`,
      [username, hash, displayName, email || null, role]
    );
    persist();
    const idStmt = db.prepare('SELECT last_insert_rowid() AS id');
    idStmt.step();
    const idRow = idStmt.getAsObject();
    idStmt.free();
    return { ok: true, id: idRow?.id };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('UNIQUE')) {
      return { ok: false, error: 'Este nome de usuário já existe.' };
    }
    return { ok: false, error: 'Não foi possível criar o usuário.' };
  }
}

function updateSystemUser(payload) {
  const pid = Number(payload?.id);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: 'Usuário inválido.' };
  }
  const existing = getSystemUserRowById(pid);
  if (!existing) {
    return { ok: false, error: 'Usuário não encontrado.' };
  }

  const displayName = String(payload?.displayName ?? existing.display_name ?? '').trim();
  const email = String(payload?.email ?? '').trim();
  const roleRaw = String(payload?.role ?? existing.role ?? 'medico').toLowerCase();
  const role = roleRaw === 'admin' ? 'admin' : 'medico';
  const password = String(payload?.password || '');

  if (!displayName) {
    return { ok: false, error: 'Informe o nome para exibição.' };
  }

  const wasAdmin = String(existing.role || '').toLowerCase() === 'admin';
  if (wasAdmin && role !== 'admin') {
    const stmt = db.prepare(
      `SELECT COUNT(*) AS c FROM users WHERE lower(role) = 'admin' AND active = 1 AND id != ?`
    );
    stmt.bind([pid]);
    stmt.step();
    const otherAdmins = Number(stmt.getAsObject().c || 0);
    stmt.free();
    if (otherAdmins < 1) {
      return { ok: false, error: 'É necessário manter pelo menos um administrador ativo.' };
    }
  }

  if (password.length > 0) {
    if (password.length < 4) {
      return { ok: false, error: 'A senha deve ter pelo menos 4 caracteres.' };
    }
    const hash = bcrypt.hashSync(password, 10);
    db.run(`UPDATE users SET display_name = ?, email = ?, role = ?, password_hash = ? WHERE id = ?`, [
      displayName,
      email || null,
      role,
      hash,
      pid,
    ]);
  } else {
    db.run(`UPDATE users SET display_name = ?, email = ?, role = ? WHERE id = ?`, [
      displayName,
      email || null,
      role,
      pid,
    ]);
  }
  persist();
  return { ok: true };
}

function setSystemUserActive(userId, active, currentUsername) {
  const pid = Number(userId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: 'Usuário inválido.' };
  }
  const row = getSystemUserRowById(pid);
  if (!row) {
    return { ok: false, error: 'Usuário não encontrado.' };
  }

  const cur = String(currentUsername || '').trim().toLowerCase();
  const uname = String(row.username || '').trim().toLowerCase();

  if (!active) {
    if (cur && uname === cur) {
      return { ok: false, error: 'Você não pode desativar seu próprio usuário.' };
    }
    const isAdmin = String(row.role || '').toLowerCase() === 'admin';
    if (isAdmin && Number(row.active)) {
      const stmt = db.prepare(
        `SELECT COUNT(*) AS c FROM users WHERE lower(role) = 'admin' AND active = 1 AND id != ?`
      );
      stmt.bind([pid]);
      stmt.step();
      const otherAdmins = Number(stmt.getAsObject().c || 0);
      stmt.free();
      if (otherAdmins < 1) {
        return { ok: false, error: 'É necessário manter pelo menos um administrador ativo.' };
      }
    }
  }

  db.run('UPDATE users SET active = ? WHERE id = ?', [active ? 1 : 0, pid]);
  persist();
  return { ok: true };
}

function normalizeCpf(cpf) {
  return String(cpf || '').replace(/\D/g, '');
}

function normalizePhoneDigits(phone) {
  return String(phone || '').replace(/\D/g, '');
}

/** Telefone BR: DDD + número (10 ou 11 dígitos) */
function isPhoneComplete(phoneDigits) {
  const d = normalizePhoneDigits(phoneDigits);
  return d.length >= 10 && d.length <= 11;
}

function createPatient(fullName, cpf, phone) {
  const cpfDigits = normalizeCpf(cpf);
  const phoneDigits = normalizePhoneDigits(phone);
  if (!fullName || !String(fullName).trim()) {
    return { ok: false, error: 'Informe o nome completo.' };
  }
  if (cpfDigits.length !== 11) {
    return { ok: false, error: 'CPF deve ter 11 dígitos.' };
  }
  if (!isPhoneComplete(phoneDigits)) {
    return { ok: false, error: 'Informe o telefone completo (DDD + número).' };
  }
  if (findPatientIdByCpf(cpfDigits) !== null) {
    return { ok: false, error: 'Este CPF já está cadastrado.' };
  }
  try {
    db.run('INSERT INTO patients (full_name, cpf, phone) VALUES (?, ?, ?)', [
      String(fullName).trim(),
      cpfDigits,
      phoneDigits,
    ]);
    const idStmt = db.prepare('SELECT last_insert_rowid() AS id');
    idStmt.step();
    const idRow = idStmt.getAsObject();
    idStmt.free();
    const id = idRow && idRow.id != null ? idRow.id : null;
    persist();
    return { ok: true, id };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('UNIQUE')) {
      return { ok: false, error: 'CPF já cadastrado.' };
    }
    return { ok: false, error: 'Não foi possível salvar o paciente.' };
  }
}

function setPatientPhotoPath(patientId, relativePath) {
  db.run('UPDATE patients SET photo_path = ? WHERE id = ?', [relativePath, patientId]);
  persist();
}

function getPatientById(id) {
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) {
    return null;
  }
  const stmt = db.prepare(
    'SELECT id, full_name, cpf, phone, photo_path, created_at, blocked FROM patients WHERE id = ?'
  );
  stmt.bind([pid]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return row;
}

/** Retorna o id do paciente com esse CPF ou null (CPF único na base). */
function findPatientIdByCpf(cpf) {
  const d = normalizeCpf(cpf);
  if (d.length !== 11) {
    return null;
  }
  const stmt = db.prepare('SELECT id FROM patients WHERE cpf = ?');
  stmt.bind([d]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return row.id != null ? Number(row.id) : null;
}

function searchPatientsByName(query, limit = 15) {
  const lim = Math.min(50, Math.max(1, Number(limit) || 15));
  const q = String(query || '').trim();
  if (!q) {
    const stmt = db.prepare(
      `SELECT id, full_name, cpf, phone, photo_path FROM patients
       ORDER BY datetime(created_at) DESC LIMIT ?`
    );
    stmt.bind([lim]);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
  const needle = `%${q.replace(/%/g, '')}%`;
  const stmt = db.prepare(
    `SELECT id, full_name, cpf, phone, photo_path FROM patients
     WHERE full_name LIKE ? COLLATE NOCASE
     ORDER BY full_name ASC LIMIT ?`
  );
  stmt.bind([needle, lim]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function updatePatient(id, fullName, cpf, phone) {
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: 'Paciente inválido.' };
  }
  const cpfDigits = normalizeCpf(cpf);
  const phoneDigits = normalizePhoneDigits(phone);
  if (!fullName || !String(fullName).trim()) {
    return { ok: false, error: 'Informe o nome completo.' };
  }
  if (cpfDigits.length !== 11) {
    return { ok: false, error: 'CPF deve ter 11 dígitos.' };
  }
  if (!isPhoneComplete(phoneDigits)) {
    return { ok: false, error: 'Informe o telefone completo (DDD + número).' };
  }
  const cpfOwnerId = findPatientIdByCpf(cpfDigits);
  if (cpfOwnerId !== null && cpfOwnerId !== pid) {
    return { ok: false, error: 'Este CPF já pertence a outro paciente.' };
  }
  try {
    db.run('UPDATE patients SET full_name = ?, cpf = ?, phone = ? WHERE id = ?', [
      String(fullName).trim(),
      cpfDigits,
      phoneDigits,
      pid,
    ]);
    persist();
    return { ok: true };
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes('UNIQUE')) {
      return { ok: false, error: 'Este CPF já pertence a outro paciente.' };
    }
    return { ok: false, error: 'Não foi possível atualizar o paciente.' };
  }
}

function listPatients() {
  const stmt = db.prepare(
    'SELECT id, full_name, cpf, phone, photo_path, created_at, blocked FROM patients ORDER BY datetime(created_at) DESC'
  );
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/** Segunda-feira 00:00 local da semana de `d`. */
function startOfWeekMonday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diffFromMonday = (day + 6) % 7;
  x.setDate(x.getDate() - diffFromMonday);
  return x;
}

/** Domingo da semana corrente (mesmo dia que `d`), em ISO local. */
function endOfWeekSundayIso(d) {
  const start = startOfWeekMonday(d);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return formatIsoDateLocal(end);
}

function compareIsoDates(a, b) {
  return String(a || '').localeCompare(String(b || ''));
}

/**
 * Lista pacientes com validade do exame vigente (status Válido) e categoria de atenção.
 * `attention`: valido | vence_semana | vencido | sem_exame
 */
function lastAccessMapByPatient() {
  const map = new Map();
  const stmt = db.prepare(`
    SELECT patient_id, MAX(created_at) AS last_at
    FROM access_events
    GROUP BY patient_id
  `);
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const pid = row.patient_id != null ? Number(row.patient_id) : null;
    if (pid != null && row.last_at) {
      map.set(pid, String(row.last_at));
    }
  }
  stmt.free();
  return map;
}

function listPatientsOverview() {
  const patients = listPatients();
  const today = formatIsoDateLocal(new Date());
  const weekEnd = endOfWeekSundayIso(new Date());
  const lastByPatient = lastAccessMapByPatient();

  const rows = [];
  for (const p of patients) {
    const pid = Number(p.id);
    let validUntil = null;
    const stmt = db.prepare(
      `SELECT valid_until FROM exams
       WHERE patient_id = ? AND status = 'Válido'
       ORDER BY datetime(valid_until) DESC LIMIT 1`
    );
    stmt.bind([pid]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      validUntil = row.valid_until ? String(row.valid_until).slice(0, 10) : null;
    }
    stmt.free();

    let attention = 'sem_exame';
    if (validUntil) {
      if (compareIsoDates(validUntil, today) < 0) {
        attention = 'vencido';
      } else if (
        compareIsoDates(validUntil, weekEnd) <= 0 &&
        compareIsoDates(validUntil, today) >= 0
      ) {
        attention = 'vence_semana';
      } else {
        attention = 'valido';
      }
    }

    rows.push({
      id: p.id,
      full_name: p.full_name,
      cpf: p.cpf,
      phone: p.phone,
      photo_path: p.photo_path,
      valid_until: validUntil,
      attention,
      blocked: Boolean(Number(p.blocked)),
      last_access_at: lastByPatient.get(pid) || null,
    });
  }
  return rows;
}

/**
 * Registra tentativa de acesso à piscina (ex.: leitura facial / catraca).
 * Liberado: exame válido (incl. vence nesta semana) e paciente não bloqueado.
 */
function registerPoolAccess(patientId, location) {
  const pid = Number(patientId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: 'Paciente inválido.' };
  }
  const p = getPatientById(pid);
  if (!p) {
    return { ok: false, error: 'Paciente não encontrado.' };
  }
  const today = formatIsoDateLocal(new Date());
  const weekEnd = endOfWeekSundayIso(new Date());
  let validUntil = null;
  const exStmt = db.prepare(
    `SELECT valid_until FROM exams
     WHERE patient_id = ? AND status = 'Válido'
     ORDER BY datetime(valid_until) DESC LIMIT 1`
  );
  exStmt.bind([pid]);
  if (exStmt.step()) {
    const row = exStmt.getAsObject();
    validUntil = row.valid_until ? String(row.valid_until).slice(0, 10) : null;
  }
  exStmt.free();

  let attention = 'sem_exame';
  if (validUntil) {
    if (compareIsoDates(validUntil, today) < 0) {
      attention = 'vencido';
    } else if (
      compareIsoDates(validUntil, weekEnd) <= 0 &&
      compareIsoDates(validUntil, today) >= 0
    ) {
      attention = 'vence_semana';
    } else {
      attention = 'valido';
    }
  }

  const blocked = Boolean(Number(p.blocked));
  const granted =
    !blocked && (attention === 'valido' || attention === 'vence_semana');

  const loc =
    location && String(location).trim()
      ? String(location).trim()
      : 'Catraca principal · Piscina';
  const createdAt = new Date().toISOString();

  db.run(
    `INSERT INTO access_events (patient_id, granted, location, created_at) VALUES (?, ?, ?, ?)`,
    [pid, granted ? 1 : 0, loc, createdAt]
  );
  persist();
  return { ok: true, granted, attention, blocked };
}

function listAccessEvents(limit = 80) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 80));
  const stmt = db.prepare(`
    SELECT e.id, e.granted, e.location, e.created_at,
           p.id AS patient_id, p.full_name, p.cpf, p.photo_path
    FROM access_events e
    JOIN patients p ON p.id = e.patient_id
    ORDER BY datetime(e.created_at) DESC
    LIMIT ?
  `);
  stmt.bind([lim]);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function accessStatsToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const stmt = db.prepare('SELECT granted, created_at FROM access_events');
  let total = 0;
  let granted = 0;
  let denied = 0;
  while (stmt.step()) {
    const row = stmt.getAsObject();
    const t = new Date(String(row.created_at || ''));
    if (Number.isNaN(t.getTime())) continue;
    if (t >= start && t < end) {
      total += 1;
      if (Number(row.granted)) {
        granted += 1;
      } else {
        denied += 1;
      }
    }
  }
  stmt.free();
  return { total, granted, denied };
}

function setPatientBlocked(patientId, blocked) {
  const pid = Number(patientId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: 'Paciente inválido.' };
  }
  if (!getPatientById(pid)) {
    return { ok: false, error: 'Paciente não encontrado.' };
  }
  try {
    db.run('UPDATE patients SET blocked = ? WHERE id = ?', [blocked ? 1 : 0, pid]);
    persist();
    return { ok: true };
  } catch {
    return { ok: false, error: 'Não foi possível atualizar o bloqueio.' };
  }
}

function listExamsDone() {
  const stmt = db.prepare(`
    SELECT e.id, e.exam_date, e.valid_until, e.status, e.created_at,
           p.id AS patient_id, p.full_name AS patient_name, p.cpf AS patient_cpf
    FROM exams e
    JOIN patients p ON p.id = e.patient_id
    ORDER BY datetime(e.created_at) DESC
  `);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

function deleteExamById(examId) {
  const eid = Number(examId);
  if (!Number.isFinite(eid) || eid <= 0) {
    return { ok: false, error: 'Exame inválido.' };
  }
  const chk = db.prepare('SELECT id FROM exams WHERE id = ?');
  chk.bind([eid]);
  if (!chk.step()) {
    chk.free();
    return { ok: false, error: 'Exame não encontrado.' };
  }
  chk.free();
  try {
    db.run('DELETE FROM exams WHERE id = ?', [eid]);
    persist();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Não foi possível excluir o exame.' };
  }
}

/** Validade do exame em dias (regra de negócio). */
const EXAM_VALIDITY_DAYS = 30;

function formatIsoDateLocal(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysToIsoDate(isoDateStr, days) {
  const [y, mo, da] = String(isoDateStr).split('-').map(Number);
  const dt = new Date(y, mo - 1, da);
  dt.setDate(dt.getDate() + Number(days));
  return formatIsoDateLocal(dt);
}

function deletePatientById(id) {
  const pid = Number(id);
  if (!Number.isFinite(pid) || pid <= 0) return;
  db.run('DELETE FROM access_events WHERE patient_id = ?', [pid]);
  db.run('DELETE FROM patients WHERE id = ?', [pid]);
  persist();
}

/** Remove exames do paciente e o próprio registro (exclusão definitiva). */
function removePatient(patientId) {
  const pid = Number(patientId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: 'Paciente inválido.' };
  }
  const p = getPatientById(pid);
  if (!p) {
    return { ok: false, error: 'Paciente não encontrado.' };
  }
  try {
    db.run('DELETE FROM access_events WHERE patient_id = ?', [pid]);
    db.run('DELETE FROM exams WHERE patient_id = ?', [pid]);
    db.run('DELETE FROM patients WHERE id = ?', [pid]);
    persist();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'Não foi possível excluir o paciente.' };
  }
}

/**
 * Registra exame: data do exame (ou hoje) e validade = data + 30 dias.
 * Revalidação antes do fim dos 30 dias: exames ainda vigentes do mesmo paciente
 * passam a status "Substituído"; o novo registro é o período válido atual.
 */
function createExam(patientId, examDateIso) {
  const pid = Number(patientId);
  if (!Number.isFinite(pid) || pid <= 0) {
    return { ok: false, error: 'Paciente inválido.' };
  }
  const existing = getPatientById(pid);
  if (!existing) {
    return { ok: false, error: 'Paciente não encontrado.' };
  }
  let examDate = examDateIso;
  if (!examDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(examDate))) {
    examDate = formatIsoDateLocal(new Date());
  }
  const validUntil = addDaysToIsoDate(examDate, EXAM_VALIDITY_DAYS);
  const today = formatIsoDateLocal(new Date());
  try {
    db.run(
      `UPDATE exams SET status = 'Substituído'
       WHERE patient_id = ? AND valid_until >= ? AND status = 'Válido'`,
      [pid, today]
    );
    db.run(
      `INSERT INTO exams (patient_id, exam_date, valid_until, status) VALUES (?, ?, ?, ?)`,
      [pid, examDate, validUntil, 'Válido']
    );
    persist();
    return { ok: true, examDate, validUntil };
  } catch (e) {
    return { ok: false, error: 'Não foi possível registrar o exame.' };
  }
}

/**
 * Relatórios administrativos: KPIs e listas para exames vencendo / vencidos no período.
 * `valid_until` da visão geral: último exame com status Válido.
 */
function normalizeReportPeriod(periodStart, periodEnd) {
  const today = formatIsoDateLocal(new Date());
  let start = String(periodStart || '').slice(0, 10);
  let end = String(periodEnd || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) start = today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) end = today;
  if (compareIsoDates(start, end) > 0) {
    const t = start;
    start = end;
    end = t;
  }
  return { start, end, today };
}

function adminReportsSummary(periodStart, periodEnd) {
  const { start, end, today } = normalizeReportPeriod(periodStart, periodEnd);

  const exStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM exams
    WHERE substr(COALESCE(exam_date, created_at), 1, 10) >= ?
      AND substr(COALESCE(exam_date, created_at), 1, 10) <= ?
  `);
  exStmt.bind([start, end]);
  exStmt.step();
  const examsDone = Number(exStmt.getAsObject().c || 0);
  exStmt.free();

  const acStmt = db.prepare(`
    SELECT COUNT(*) AS c FROM access_events
    WHERE granted = 1
      AND substr(created_at, 1, 10) >= ?
      AND substr(created_at, 1, 10) <= ?
  `);
  acStmt.bind([start, end]);
  acStmt.step();
  const entriesInPeriod = Number(acStmt.getAsObject().c || 0);
  acStmt.free();

  const blStmt = db.prepare(`SELECT COUNT(*) AS c FROM patients WHERE blocked = 1`);
  blStmt.step();
  const blockedTotal = Number(blStmt.getAsObject().c || 0);
  blStmt.free();

  const overview = listPatientsOverview();
  const windowLow = compareIsoDates(start, today) >= 0 ? start : today;

  let expiringInPeriod = 0;
  let expiredTotal = 0;
  let expiredInPeriod = 0;

  for (const row of overview) {
    const vu = row.valid_until ? String(row.valid_until).slice(0, 10) : null;
    if (!vu) continue;

    const isExpired = compareIsoDates(vu, today) < 0;
    if (isExpired) {
      expiredTotal += 1;
      if (compareIsoDates(vu, start) >= 0 && compareIsoDates(vu, end) <= 0) {
        expiredInPeriod += 1;
      }
      continue;
    }

    if (
      compareIsoDates(vu, windowLow) >= 0 &&
      compareIsoDates(vu, end) <= 0 &&
      compareIsoDates(vu, today) >= 0
    ) {
      expiringInPeriod += 1;
    }
  }

  return {
    periodStart: start,
    periodEnd: end,
    examsDone,
    entriesInPeriod,
    blockedTotal,
    expiringInPeriod,
    expiredTotal,
    expiredInPeriod,
  };
}

const REPORT_EXAM_LABEL = 'Exame de aptidão (piscina)';

function adminReportsRows(kind, periodStart, periodEnd) {
  const { start, end, today } = normalizeReportPeriod(periodStart, periodEnd);
  const windowLow = compareIsoDates(start, today) >= 0 ? start : today;
  const wantExpired = kind === 'vencidas';

  const overview = listPatientsOverview();
  const out = [];

  for (const row of overview) {
    const vu = row.valid_until ? String(row.valid_until).slice(0, 10) : null;
    if (!vu) continue;

    if (wantExpired) {
      if (compareIsoDates(vu, today) >= 0) continue;
      if (compareIsoDates(vu, start) < 0 || compareIsoDates(vu, end) > 0) continue;
    } else {
      if (compareIsoDates(vu, today) < 0) continue;
      if (compareIsoDates(vu, windowLow) < 0 || compareIsoDates(vu, end) > 0) continue;
    }

    out.push({
      patient_id: row.id,
      full_name: row.full_name,
      cpf: row.cpf,
      phone: row.phone,
      valid_until: vu,
      exam_label: REPORT_EXAM_LABEL,
    });
  }

  out.sort((a, b) => String(a.valid_until).localeCompare(String(b.valid_until)));
  return out;
}

/** Estatísticas do arquivo SQLite local (painel de sincronização). */
function getLocalDbStats() {
  const q = (sql) => {
    try {
      const r = db.exec(sql);
      return Number(r[0]?.values[0]?.[0] ?? 0);
    } catch {
      return 0;
    }
  };
  let dbBytes = 0;
  try {
    if (dbPath && fs.existsSync(dbPath)) {
      dbBytes = fs.statSync(dbPath).size;
    }
  } catch {
    /* ignore */
  }
  const patients = q('SELECT COUNT(*) FROM patients');
  const exams = q('SELECT COUNT(*) FROM exams');
  const access_events = q('SELECT COUNT(*) FROM access_events');
  const users = q('SELECT COUNT(*) FROM users');
  const pendingPhotos = q(
    `SELECT COUNT(*) FROM patients WHERE photo_path IS NULL OR TRIM(COALESCE(photo_path, '')) = ''`
  );
  const totalRows = patients + exams + access_events + users;
  return {
    dbBytes,
    totalRows,
    patients,
    exams,
    access_events,
    /** Itens de fila de envio à nuvem (placeholder até integração Supabase). */
    pendingExams: 0,
    pendingPhotos,
  };
}

module.exports = {
  initDb,
  authenticateUser,
  listSystemUsers,
  createSystemUser,
  updateSystemUser,
  setSystemUserActive,
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
  EXAM_VALIDITY_DAYS,
  adminReportsSummary,
  adminReportsRows,
  getLocalDbStats,
};
