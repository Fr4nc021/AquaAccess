/**
 * Servidor HTTP local para integração com Intelbras XPE (Ações URL → Log de Acesso).
 * O equipamento envia GET/POST para o PC; aplicamos as regras do banco (exame/bloqueio).
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const querystring = require('querystring');

function parseBodyBuffer(buf, contentType) {
  const raw = buf.toString('utf8').trim();
  if (!raw) return {};
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return { _parseError: true, _raw: raw };
    }
  }
  try {
    return querystring.parse(raw);
  } catch {
    return { _raw: raw };
  }
}

function extractUserRef(reqUrl, bodyObj) {
  const q = Object.fromEntries(reqUrl.searchParams);
  const keys = [
    'userId',
    'UserId',
    'userid',
    'ID',
    'id',
    'IdUsuario',
    'user_id',
    'patient_id',
    'patientId',
    'cpf',
    'CPF',
    'CardNo',
    'cardNo',
    'cardid',
    'CardId',
    'tag',
    'Tag',
  ];
  for (const k of keys) {
    const v = q[k] ?? bodyObj[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  const parts = reqUrl.pathname.split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  if (last && /^\d{1,12}$/.test(last)) return last;
  return null;
}

function requestOpenDoor(fullUrl, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      resolve({ ok: !err, error: err ? String(err.message || err) : null });
    };
    try {
      const u = new URL(fullUrl);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(fullUrl, { timeout: timeoutMs }, (res) => {
        res.resume();
        finish(res.statusCode >= 400 ? new Error(`HTTP ${res.statusCode}`) : null);
      });
      req.on('error', finish);
      req.on('timeout', () => {
        req.destroy();
        finish(new Error('timeout'));
      });
    } catch (e) {
      finish(e);
    }
  });
}

function buildOpenDoorUrl(base, user, password, doorNum) {
  const b = String(base || '').trim().replace(/\/+$/, '');
  if (!b) return null;
  const u = encodeURIComponent(String(user || ''));
  const p = encodeURIComponent(String(password || ''));
  const d = encodeURIComponent(String(doorNum != null ? doorNum : '1'));
  return `${b}/fcgi/do?action=OpenDoor&UserName=${u}&Password=${p}&DoorNum=${d}`;
}

/**
 * @param {object} opts
 * @param {number} opts.port
 * @param {string} [opts.host]
 * @param {string} opts.path  ex.: /intelbras/xpe
 * @param {string} [opts.sharedSecret] header X-AquaAccess-Token
 * @param {(userRef: string, meta: object) => Promise<{ granted?: boolean, unknown?: boolean }>} opts.onAccess
 * @param {() => { openDoorWhenGranted?: boolean, openDoorBaseUrl?: string, openDoorUser?: string, openDoorPassword?: string, openDoorNum?: string }} [opts.getDoorConfig]
 * @param {(line: string) => void} [opts.log]
 * @param {(record: object) => void} [opts.recordInbound] auditoria bruta (NDJSON no main) para alinhar URL/corpo ao XPE
 */
function startXpeBridge(opts) {
  const {
    port,
    host = '0.0.0.0',
    path: mountPath = '/intelbras/xpe',
    sharedSecret = '',
    onAccess,
    getDoorConfig,
    log,
    recordInbound,
  } = opts;

  const normalizedMount = mountPath.startsWith('/') ? mountPath : `/${mountPath}`;

  const server = http.createServer((req, res) => {
    const hostHeader = req.headers.host || `127.0.0.1:${port}`;
    let reqUrl;
    try {
      reqUrl = new URL(req.url || '/', `http://${hostHeader}`);
    } catch {
      res.writeHead(400);
      res.end('bad request');
      return;
    }

    const pathOk =
      reqUrl.pathname === normalizedMount || reqUrl.pathname.startsWith(`${normalizedMount}/`);
    if (!pathOk) {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      void (async () => {
        const buf = Buffer.concat(chunks);
        const bodyObj = parseBodyBuffer(buf, req.headers['content-type']);
        const queryObj = Object.fromEntries(reqUrl.searchParams);

        const safeHeader = (name) => {
          const v = req.headers[name];
          return v != null ? String(v) : '';
        };

        const baseRecord = {
          at: new Date().toISOString(),
          method: req.method,
          pathname: reqUrl.pathname,
          search: reqUrl.search || '',
          query: queryObj,
          contentType: safeHeader('content-type'),
          bodyKeys: Object.keys(bodyObj).filter((k) => !k.startsWith('_')),
          bodyRawPreview: buf.length ? buf.toString('utf8').slice(0, 8000) : '',
        };

        const writeLog = (extra) => {
          if (typeof recordInbound !== 'function') return;
          try {
            recordInbound({ ...baseRecord, ...extra });
          } catch {
            /* ignore */
          }
        };

        if (sharedSecret) {
          const tok =
            req.headers['x-aquaaccess-token'] ||
            req.headers['x-aquaaccess-secret'] ||
            req.headers['x-intelbras-bridge-token'];
          if (String(tok || '') !== String(sharedSecret)) {
            writeLog({ outcome: 'unauthorized', httpStatus: 401, userRefExtracted: null });
            res.writeHead(401);
            res.end('unauthorized');
            return;
          }
        }

        const userRef = extractUserRef(reqUrl, bodyObj);
        const meta = {
          method: req.method,
          pathname: reqUrl.pathname,
          query: queryObj,
          bodyKeys: Object.keys(bodyObj),
        };
        if (log) {
          log(
            `[xpe-bridge] ${req.method} ${reqUrl.pathname} userRef=${userRef ?? '—'} query=${JSON.stringify(meta.query)}`
          );
        }

        if (!userRef) {
          writeLog({ outcome: 'missing_user_ref', httpStatus: 400, userRefExtracted: null });
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: 'missing_user_ref' }));
          return;
        }

        try {
          const result = (await onAccess(userRef, meta)) || {};
          const granted = Boolean(result.granted);
          const unknown = Boolean(result.unknown);
          const doorCfg = typeof getDoorConfig === 'function' ? getDoorConfig() || {} : {};
          let openDoorError = null;
          if (granted && doorCfg.openDoorWhenGranted) {
            const url = buildOpenDoorUrl(
              doorCfg.openDoorBaseUrl,
              doorCfg.openDoorUser,
              doorCfg.openDoorPassword,
              doorCfg.openDoorNum
            );
            if (url) {
              const od = await requestOpenDoor(url);
              if (!od.ok) openDoorError = od.error;
              if (log && !od.ok) log(`[xpe-bridge] OpenDoor falhou: ${od.error}`);
            }
          }
          writeLog({
            outcome: unknown ? 'unknown_user' : granted ? 'granted' : 'denied',
            httpStatus: 200,
            userRefExtracted: userRef,
            granted,
            unknown,
            openDoorError,
          });
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(
            JSON.stringify({
              ok: true,
              granted,
              unknown,
            })
          );
        } catch (e) {
          writeLog({
            outcome: 'server_error',
            httpStatus: 500,
            userRefExtracted: userRef,
            error: String(e?.message || e),
          });
          res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      })();
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve({
        server,
        stop() {
          return new Promise((res) => {
            server.close(() => res());
          });
        },
        port,
        host,
      });
    });
  });
}

module.exports = {
  startXpeBridge,
  buildOpenDoorUrl,
  extractUserRef,
};
