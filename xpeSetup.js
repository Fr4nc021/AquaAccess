/**
 * Descoberta de rede e configuração automática Intelbras XPE ↔ AquaAccess.
 */
const http = require('http');
const https = require('https');
const net = require('net');
const os = require('os');
const { URL } = require('url');

const DEFAULT_BRIDGE_PORT = 37891;
const FALLBACK_BRIDGE_PORTS = [37891, 5832, 37892, 37901];

function normalizeIpv4(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  for (let i = 1; i <= 4; i += 1) {
    const n = Number(m[i]);
    if (n < 0 || n > 255) return null;
  }
  return s;
}

/** Converte "192168067" → 192.168.0.67 quando possível. */
function normalizeIpv4Loose(raw) {
  const dotted = normalizeIpv4(raw);
  if (dotted) return dotted;
  const digits = String(raw || '').replace(/\D/g, '');
  if (digits.length === 12) {
    return normalizeIpv4(
      `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}.${digits.slice(9, 12)}`
    );
  }
  if (digits.length === 11) {
    return normalizeIpv4(
      `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}.${digits.slice(9, 11)}`
    );
  }
  return null;
}

/**
 * @param {string} input URL ou host do Intelbras
 * @returns {{ ok: boolean, host?: string, port?: number, baseUrl?: string, error?: string }}
 */
function parseIntelbrasDeviceUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return { ok: false, error: 'Informe a URL ou o IP do Intelbras.' };
  }

  let toParse = raw;
  if (!/^[a-z]+:\/\//i.test(toParse)) {
    toParse = `http://${toParse}`;
  }

  let u;
  try {
    u = new URL(toParse);
  } catch {
    const hostOnly = normalizeIpv4Loose(raw);
    if (hostOnly) {
      return { ok: true, host: hostOnly, port: 80, baseUrl: `http://${hostOnly}` };
    }
    return { ok: false, error: 'URL ou IP inválido.' };
  }

  const host = normalizeIpv4Loose(u.hostname);
  if (!host) {
    return { ok: false, error: 'Use o IP IPv4 do equipamento (ex.: 192.168.0.67).' };
  }

  let port = Number(u.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    port = u.protocol === 'https:' ? 443 : 80;
  }

  const baseUrl = `${u.protocol}//${host}${port === 80 || port === 443 ? '' : `:${port}`}`;
  return { ok: true, host, port, baseUrl: baseUrl.replace(/\/+$/, '') };
}

function scoreLanIp(ip) {
  if (ip.startsWith('192.168.')) return 100;
  if (ip.startsWith('10.')) return 90;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 80;
  return 10;
}

/**
 * Escolhe o IP deste PC na LAN. Se deviceHost for informado, prioriza a mesma sub-rede do Intelbras.
 * @param {Array<{ ip: string }>} addresses
 * @param {string} [deviceHost] IP do equipamento (ex.: 192.168.15.4)
 */
function pickPreferredLanIp(addresses, deviceHost) {
  if (!addresses?.length) return null;

  const host = normalizeIpv4(deviceHost) || normalizeIpv4Loose(deviceHost);
  if (host) {
    const parts = host.split('.');
    const prefix = `${parts[0]}.${parts[1]}.${parts[2]}.`;
    const onSubnet = addresses.filter((a) => a.ip.startsWith(prefix));
    if (onSubnet.length) {
      onSubnet.sort((a, b) => scoreLanIp(b.ip) - scoreLanIp(a.ip));
      return onSubnet[0].ip;
    }
  }

  const sorted = [...addresses].sort((a, b) => scoreLanIp(b.ip) - scoreLanIp(a.ip));
  return sorted[0]?.ip || null;
}

/**
 * IP do computador onde o AquaAccess está instalado (manual > salvo > mesma sub-rede do XPE > detectado).
 */
function resolvePcLanIp({ addresses, deviceHost, savedLanIp } = {}) {
  const manual = normalizeIpv4(savedLanIp) || normalizeIpv4Loose(savedLanIp);
  if (manual) return manual;
  return pickPreferredLanIp(addresses, deviceHost);
}

/**
 * @param {{ deviceHost?: string }} [opts]
 */
function getLocalNetworkInfo(opts = {}) {
  const addresses = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const addr of ifaces[name] || []) {
      if (addr.family !== 'IPv4' && addr.family !== 4) continue;
      if (addr.internal) continue;
      addresses.push({
        ip: addr.address,
        interface: name,
        netmask: addr.netmask,
      });
    }
  }

  const autoDetected = pickPreferredLanIp(addresses, opts.deviceHost);
  const preferredLanIp = resolvePcLanIp({
    addresses,
    deviceHost: opts.deviceHost,
    savedLanIp: opts.savedLanIp,
  });

  return {
    hostname: os.hostname(),
    preferredLanIp: preferredLanIp || autoDetected,
    autoDetectedLanIp: autoDetected,
    addresses,
    sameSubnetAsDevice: Boolean(
      opts.deviceHost &&
        preferredLanIp &&
        pickPreferredLanIp(addresses, opts.deviceHost) === preferredLanIp
    ),
  };
}

function checkTcp(host, port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(Math.max(500, timeoutMs));
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () => finish({ ok: false, error: 'Tempo esgotado.' }));
    socket.once('error', (err) => finish({ ok: false, error: String(err?.message || err) }));
    try {
      socket.connect(port, host);
    } catch (e) {
      finish({ ok: false, error: String(e?.message || e) });
    }
  });
}

function httpProbe(baseUrl, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    try {
      const u = new URL(baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(
        u.href,
        { timeout: timeoutMs, rejectUnauthorized: false },
        (res) => {
          const chunks = [];
          res.on('data', (c) => {
            if (chunks.length < 4) chunks.push(c);
          });
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8').slice(0, 8000);
            const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(body);
            const title = titleMatch ? titleMatch[1].trim() : '';
            const looksIntelbras =
              /intelbras/i.test(body) ||
              /xpe/i.test(body) ||
              /videoporteiro/i.test(body) ||
              /fcgi/i.test(body);
            finish({
              ok: res.statusCode != null && res.statusCode < 500,
              statusCode: res.statusCode,
              title,
              looksIntelbras,
            });
          });
        }
      );
      req.on('error', (err) => finish({ ok: false, error: String(err?.message || err) }));
      req.on('timeout', () => {
        req.destroy();
        finish({ ok: false, error: 'Tempo esgotado na interface web.' });
      });
    } catch (e) {
      finish({ ok: false, error: String(e?.message || e) });
    }
  });
}

async function probeIntelbrasDevice({ host, port, baseUrl }) {
  const tcp = await checkTcp(host, port);
  let httpResult = { ok: false, skipped: true };
  if (tcp.ok && baseUrl) {
    httpResult = await httpProbe(baseUrl);
  }
  return {
    ok: tcp.ok,
    tcp,
    http: httpResult,
    host,
    port,
    baseUrl,
    summary: tcp.ok
      ? httpResult.ok
        ? httpResult.looksIntelbras
          ? 'Equipamento alcançado (interface web Intelbras/XPE detectada).'
          : 'Equipamento alcançado na rede (interface web respondeu).'
        : 'Porta TCP aberta, mas a página web não respondeu — confira IP/porta.'
      : `Sem conexão TCP em ${host}:${port}. ${tcp.error || ''}`.trim(),
  };
}

function normalizeBridgePath(path) {
  let p = String(path || '/intelbras/xpe').trim() || '/intelbras/xpe';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  return p;
}

function buildActionUrlLogAccess({ lanIp, bridgePort, bridgePath }) {
  const ip = String(lanIp || '').trim();
  const port = Number(bridgePort) || DEFAULT_BRIDGE_PORT;
  const path = normalizeBridgePath(bridgePath);
  if (!ip) return '';
  return `http://${ip}:${port}${path}`;
}

function buildSetupInstructions(actionUrl) {
  return [
    'No Intelbras: Configuração → Ações URL',
    'Método: HTTP-POST (ou GET, conforme seu firmware)',
    `Campo "Log Acesso": cole a URL abaixo`,
    actionUrl,
    'ID Usuário no XPE = ID do paciente no AquaAccess (recomendado)',
    'Salve com "Aplicar" no equipamento',
  ];
}

/**
 * @param {number[]} portsToTry
 * @param {number} [currentlyConfigured]
 */
function pickBridgePort(portsToTry = FALLBACK_BRIDGE_PORTS, currentlyConfigured) {
  const list = [];
  if (Number.isInteger(currentlyConfigured) && currentlyConfigured >= 1) {
    list.push(currentlyConfigured);
  }
  for (const p of portsToTry) {
    if (!list.includes(p)) list.push(p);
  }
  return list[0] || DEFAULT_BRIDGE_PORT;
}

/**
 * Monta plano de configuração após URL do Intelbras + rede local.
 */
function buildSetupPlan({
  deviceUrl,
  lanIp,
  bridgePort,
  bridgePath,
  webUser,
  probe,
}) {
  const parsed = parseIntelbrasDeviceUrl(deviceUrl);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const path = normalizeBridgePath(bridgePath);
  const port = pickBridgePort(FALLBACK_BRIDGE_PORTS, Number(bridgePort) || undefined);
  const pcIp = lanIp || null;
  const actionUrl = buildActionUrlLogAccess({
    lanIp: pcIp,
    bridgePort: port,
    bridgePath: path,
  });

  const missing = [];
  if (!pcIp) missing.push('IP deste computador na rede (não detectado automaticamente)');
  if (!webUser) missing.push('Usuário web do XPE (opcional — necessário para sincronizar via Playwright e OpenDoor)');

  return {
    ok: true,
    device: {
      ip: parsed.host,
      port: parsed.port,
      baseUrl: parsed.baseUrl,
    },
    bridge: {
      enabled: true,
      port,
      path,
      host: '0.0.0.0',
      logInboundRequests: true,
      openDoorWhenGranted: false,
      openDoorBaseUrl: parsed.baseUrl,
      openDoorUser: webUser ? String(webUser).trim() : '',
    },
    preferredLanIp: pcIp,
    actionUrlLogAccess: actionUrl,
    actionUrlExample: actionUrl ? `${actionUrl}?userId=1` : '',
    instructions: buildSetupInstructions(actionUrl),
    probe: probe || null,
    missing,
    needsManualInXpe: Boolean(actionUrl),
  };
}

module.exports = {
  DEFAULT_BRIDGE_PORT,
  FALLBACK_BRIDGE_PORTS,
  normalizeIpv4,
  normalizeIpv4Loose,
  parseIntelbrasDeviceUrl,
  getLocalNetworkInfo,
  pickPreferredLanIp,
  resolvePcLanIp,
  probeIntelbrasDevice,
  buildActionUrlLogAccess,
  buildSetupPlan,
  pickBridgePort,
  normalizeBridgePath,
  checkTcp,
};
