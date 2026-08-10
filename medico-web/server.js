/**
 * POC: cadastro médico no browser → Intelbras XPE (porta local).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { syncRegistrationToXpe } = require('./syncToXpe');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const PHOTOS = path.join(DATA, 'photos');
const REGISTRY = path.join(DATA, 'registry.json');
const CONFIG_PATH = path.join(ROOT, 'config.json');

function loadConfig() {
  const defaults = {
    listenHost: '0.0.0.0',
    listenPort: 3847,
    xpeUrl: 'http://192.168.15.44',
    xpeUser: 'admin',
    xpePassword: '',
    headless: false,
    slowMo: 400,
  };
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return { ...defaults, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
  } catch (e) {
    console.warn('[medico-web] config.json inválido:', e.message);
  }
  return defaults;
}

function ensureDataDirs() {
  fs.mkdirSync(PHOTOS, { recursive: true });
  fs.mkdirSync(path.join(DATA, 'errors'), { recursive: true });
  if (!fs.existsSync(REGISTRY)) {
    fs.writeFileSync(REGISTRY, JSON.stringify({ nextId: 1, items: [] }, null, 2), 'utf8');
  }
}

function readRegistry() {
  ensureDataDirs();
  try {
    return JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));
  } catch {
    return { nextId: 1, items: [] };
  }
}

function writeRegistry(reg) {
  fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2), 'utf8');
}

function allocateId() {
  const reg = readRegistry();
  let id = Number(reg.nextId) || 1;
  if (id < 1) id = 1;
  // XPE: ID Usuário 1–11 caracteres
  const idStr = String(id);
  if (idStr.length > 11) {
    throw new Error('Limite de IDs do XPE (máx. 11 caracteres) atingido neste POC.');
  }
  reg.nextId = id + 1;
  writeRegistry(reg);
  return idStr;
}

function sendJson(res, status, body) {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(raw);
}

function serveStatic(req, res, urlPath) {
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  rel = decodeURIComponent(rel).replace(/\?.*$/, '');
  const full = path.normalize(path.join(PUBLIC, rel));
  if (!full.startsWith(PUBLIC)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const ext = path.extname(full).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function savePhotoFromDataUrl(userId, dataUrl) {
  const m = String(dataUrl || '').match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
  if (!m) return null;
  let ext = m[1].toLowerCase();
  if (ext === 'jpeg') ext = 'jpg';
  // Preferir .jpg no disco para o XPE
  if (ext !== 'jpg') {
    // Mantém bytes originais com extensão; sync exige jpg — frontend envia jpeg
    if (ext === 'png' || ext === 'webp') {
      // Aceita mas avisa; XPE sync pode falhar — frontend força jpeg
    }
  }
  const buf = Buffer.from(m[2], 'base64');
  const fileExt = ext === 'jpg' ? 'jpg' : ext;
  const file = path.join(PHOTOS, `${userId}.${fileExt}`);
  fs.writeFileSync(file, buf);
  return file;
}

let syncBusy = false;

async function handleRegister(req, res) {
  if (syncBusy) {
    sendJson(res, 409, { ok: false, error: 'Já existe um envio ao XPE em andamento. Aguarde.' });
    return;
  }

  const cfg = loadConfig();
  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw.toString('utf8'));
  } catch (e) {
    sendJson(res, 400, { ok: false, error: e.message || 'JSON inválido.' });
    return;
  }

  const name = String(payload.name || '').trim();
  const photoDataUrl = String(payload.photoDataUrl || '');
  if (!name) {
    sendJson(res, 400, { ok: false, error: 'Informe o nome.' });
    return;
  }
  if (!photoDataUrl) {
    sendJson(res, 400, { ok: false, error: 'Envie a foto (upload ou câmera).' });
    return;
  }

  let userId;
  try {
    userId = allocateId();
  } catch (e) {
    sendJson(res, 500, { ok: false, error: e.message });
    return;
  }

  const photoPath = savePhotoFromDataUrl(userId, photoDataUrl);
  if (!photoPath) {
    sendJson(res, 400, { ok: false, error: 'Foto inválida. Use JPG (recomendado), PNG ou WebP.' });
    return;
  }
  if (!photoPath.toLowerCase().endsWith('.jpg') && !photoPath.toLowerCase().endsWith('.jpeg')) {
    sendJson(res, 400, {
      ok: false,
      error: 'Envie a foto em JPG. No formulário, a câmera/upload já deve gerar JPEG.',
    });
    return;
  }

  const entry = {
    id: userId,
    name,
    photoPath,
    createdAt: new Date().toISOString(),
    xpe: { status: 'pending' },
  };

  const reg = readRegistry();
  reg.items.unshift(entry);
  writeRegistry(reg);

  syncBusy = true;
  console.log(`[medico-web] cadastrando ID=${userId} nome=${name} → XPE`);
  try {
    const result = await syncRegistrationToXpe({
      userId,
      name,
      photoPath,
      xpeUrl: cfg.xpeUrl,
      xpeUser: cfg.xpeUser,
      xpePassword: cfg.xpePassword,
      headless: Boolean(cfg.headless),
      slowMo: cfg.slowMo,
      errorsDir: path.join(DATA, 'errors'),
    });

    const reg2 = readRegistry();
    const item = reg2.items.find((i) => String(i.id) === String(userId));
    if (item) {
      item.xpe = result.ok
        ? { status: 'ok', at: new Date().toISOString() }
        : {
            status: 'error',
            error: result.error || 'Falha',
            screenshot: result.screenshot || null,
            at: new Date().toISOString(),
          };
      writeRegistry(reg2);
    }

    if (result.ok) {
      sendJson(res, 200, {
        ok: true,
        userId,
        name,
        message: `ID ${userId} cadastrado e confirmado na lista do XPE.`,
      });
    } else {
      sendJson(res, 200, {
        ok: false,
        userId,
        name,
        error: result.error,
        screenshot: result.screenshot || null,
      });
    }
  } catch (e) {
    sendJson(res, 500, { ok: false, userId, error: String(e?.message || e) });
  } finally {
    syncBusy = false;
  }
}

function handleList(_req, res) {
  const reg = readRegistry();
  sendJson(res, 200, {
    ok: true,
    nextId: reg.nextId,
    items: (reg.items || []).slice(0, 50).map((i) => ({
      id: i.id,
      name: i.name,
      createdAt: i.createdAt,
      xpe: i.xpe,
    })),
  });
}

function handleConfigGet(_req, res) {
  const cfg = loadConfig();
  sendJson(res, 200, {
    ok: true,
    xpeUrl: cfg.xpeUrl,
    xpeUser: cfg.xpeUser,
    hasPassword: Boolean(cfg.xpePassword && cfg.xpePassword !== 'COLOQUE_A_SENHA_WEB_DO_XPE'),
    listenPort: cfg.listenPort,
  });
}

const cfg0 = loadConfig();
ensureDataDirs();

const server = http.createServer(async (req, res) => {
  const host = req.headers.host || `127.0.0.1:${cfg0.listenPort}`;
  let u;
  try {
    u = new URL(req.url || '/', `http://${host}`);
  } catch {
    res.writeHead(400);
    res.end('bad request');
    return;
  }

  if (req.method === 'GET' && u.pathname === '/api/list') {
    handleList(req, res);
    return;
  }
  if (req.method === 'GET' && u.pathname === '/api/config') {
    handleConfigGet(req, res);
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api/register') {
    await handleRegister(req, res);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(req, res, u.pathname);
    return;
  }
  res.writeHead(405);
  res.end('method not allowed');
});

server.listen(cfg0.listenPort, cfg0.listenHost, () => {
  console.log('');
  console.log('=== POC Médico → Intelbras XPE ===');
  console.log(`Abra no navegador: http://127.0.0.1:${cfg0.listenPort}`);
  console.log(`Na LAN:            http://<IP-deste-PC>:${cfg0.listenPort}`);
  console.log(`XPE alvo:          ${cfg0.xpeUrl} (user=${cfg0.xpeUser})`);
  console.log(`Config:            ${CONFIG_PATH}`);
  console.log('');
});
