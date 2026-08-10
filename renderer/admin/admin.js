(() => {
  if (sessionStorage.getItem('clubAccessRole') !== 'admin') {
    window.location.href = '../login/login.html';
    return;
  }

  const navBtns = document.querySelectorAll('.admin-nav-item');
  const views = {
    dashboard: document.getElementById('view-dashboard'),
    pacientes: document.getElementById('view-pacientes'),
    acessos: document.getElementById('view-acessos'),
    dispositivo: document.getElementById('view-dispositivo'),
    relatorios: document.getElementById('view-relatorios'),
    sincronizacao: document.getElementById('view-sincronizacao'),
    exames: document.getElementById('view-exames'),
    configuracoes: document.getElementById('view-configuracoes'),
  };

  const sidebarName = document.getElementById('sidebar-user-name');
  const brand = document.getElementById('sidebar-brand');

  const pacientesTbody = document.getElementById('pacientes-tbody');
  const pacientesEmpty = document.getElementById('pacientes-empty');
  const pacientesSearch = document.getElementById('pacientes-search');
  const filterPills = document.querySelectorAll('.admin-filter-pill');
  const modalEdit = document.getElementById('modal-edit-patient');
  const modalEditBackdrop = document.getElementById('modal-edit-patient-backdrop');
  const modalEditCancel = document.getElementById('modal-edit-cancel');
  const formEditPatient = document.getElementById('form-edit-patient');
  const editPatientMsg = document.getElementById('edit-patient-msg');
  const fieldEditId = document.getElementById('edit-patient-id');
  const fieldEditName = document.getElementById('edit-fullname');
  const fieldEditCpf = document.getElementById('edit-cpf');
  const fieldEditPhone = document.getElementById('edit-phone');

  const modalPacienteConfirm = document.getElementById('modal-paciente-confirm');
  const modalPacienteConfirmBackdrop = document.getElementById('modal-paciente-confirm-backdrop');
  const modalPacienteConfirmTitle = document.getElementById('modal-paciente-confirm-title');
  const modalPacienteConfirmDesc = document.getElementById('modal-paciente-confirm-desc');
  const modalPacienteConfirmCancel = document.getElementById('modal-paciente-confirm-cancel');
  const modalPacienteConfirmOk = document.getElementById('modal-paciente-confirm-ok');

  const modalPacienteAlert = document.getElementById('modal-paciente-alert');
  const modalPacienteAlertBackdrop = document.getElementById('modal-paciente-alert-backdrop');
  const modalPacienteAlertTitle = document.getElementById('modal-paciente-alert-title');
  const modalPacienteAlertDesc = document.getElementById('modal-paciente-alert-desc');
  const modalPacienteAlertOk = document.getElementById('modal-paciente-alert-ok');

  let pacienteConfirmResolve = null;
  let pacienteAlertResolve = null;

  const topbarSearch = document.getElementById('topbar-search');
  const adminTbodyExames = document.getElementById('admin-tbody-exames');
  const adminExamesEmpty = document.getElementById('admin-exames-empty');
  const adminExamesFeedback = document.getElementById('admin-exames-feedback');
  const acessosList = document.getElementById('acessos-list');
  const acessosEmpty = document.getElementById('acessos-empty');
  const acessosStatTotal = document.getElementById('acessos-stat-total');
  const acessosStatGranted = document.getElementById('acessos-stat-granted');
  const acessosStatDenied = document.getElementById('acessos-stat-denied');

  const DEVICE_SETTINGS_KEY = 'clubAccessDeviceSettings';
  const DEVICE_RUNTIME_KEY = 'clubAccessDeviceRuntime';
  const DEVICE_LOGS_KEY = 'clubAccessDeviceLogs';
  const MAX_DEVICE_LOGS = 10;
  const LS_ADMIN_LAST_FULL_SYNC = 'clubAccessAdminLastFullSync';

  const DEFAULT_DEVICE_SETTINGS = {
    deviceName: 'Intelbras XPE 3200 PLUS IP',
    locationLabel: 'Catraca principal',
    ip: '',
    firmware: '',
    clubDisplayName: 'AquaAccess',
    clubName: 'Clube Atlético Marítimo',
    systemName: 'AquaAccess',
    defaultExamValidityDays: 30,
    examAllowedWeekdays: [1, 2, 3, 4, 5],
    devicePort: '80',
    autoSync5Min: true,
    blockExpiredExams: true,
    notify5DaysBefore: true,
    notifyDeniedAccess: true,
    dailyEmailSummary: false,
    colorTheme: 'dark',
  };

  function normalizeExamAllowedWeekdays(raw) {
    if (!Array.isArray(raw)) return [...DEFAULT_DEVICE_SETTINGS.examAllowedWeekdays];
    const uniq = Array.from(
      new Set(
        raw
          .map((v) => Number(v))
          .filter((v) => Number.isInteger(v) && v >= 0 && v <= 6)
      )
    ).sort((a, b) => a - b);
    return uniq.length ? uniq : [...DEFAULT_DEVICE_SETTINGS.examAllowedWeekdays];
  }

  let pacientesCache = [];
  let pacientesFilter = 'todos';
  let pacientesSearchQ = '';
  let acessosCache = [];
  let activePage = 'dashboard';
  let acessosPollTimer = null;

  let reportKpi = 'vencendo';
  let reportRowsCache = [];
  let reportSummaryCache = null;
  let examsCache = [];

  function formatIsoLocal(d) {
    const x = d instanceof Date ? d : new Date(d);
    const y = x.getFullYear();
    const m = String(x.getMonth() + 1).padStart(2, '0');
    const day = String(x.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function defaultReportPeriod() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: formatIsoLocal(start), end: formatIsoLocal(end) };
  }

  /** Segunda a domingo da semana civil que contém hoje (local). */
  function periodThisWeek() {
    const now = new Date();
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { start: formatIsoLocal(monday), end: formatIsoLocal(sunday) };
  }

  function updateReportQuickActiveState() {
    const weekBtn = document.getElementById('reports-quick-week');
    const monthBtn = document.getElementById('reports-quick-month');
    const startEl = document.getElementById('reports-period-start');
    const endEl = document.getElementById('reports-period-end');
    if (!weekBtn || !monthBtn || !startEl || !endEl) return;
    const w = periodThisWeek();
    const m = defaultReportPeriod();
    const curS = startEl.value;
    const curE = endEl.value;
    const onVencendo = reportKpi === 'vencendo';
    weekBtn.classList.toggle('admin-reports__quick--active', onVencendo && curS === w.start && curE === w.end);
    monthBtn.classList.toggle('admin-reports__quick--active', onVencendo && curS === m.start && curE === m.end);
  }

  function applyReportsQuickPreset(which) {
    const startEl = document.getElementById('reports-period-start');
    const endEl = document.getElementById('reports-period-end');
    if (!startEl || !endEl) return;
    const p = which === 'week' ? periodThisWeek() : defaultReportPeriod();
    startEl.value = p.start;
    endEl.value = p.end;
    reportKpi = 'vencendo';
    setReportKpiCardsActive();
    void refreshReports();
  }

  function whatsappE164Digits(phone) {
    const d = String(phone || '').replace(/\D/g, '');
    if (d.length === 11 || d.length === 10) return `55${d}`;
    return d;
  }

  function buildWhatsAppUrl(phone, body) {
    const num = whatsappE164Digits(phone);
    if (!num || num.length < 12) return '';
    const text = encodeURIComponent(body);
    return `https://wa.me/${num}?text=${text}`;
  }

  function messageVencendo(name, validUntilIso) {
    const n = String(name || 'paciente').trim() || 'paciente';
    return (
      `Olá ${n}, seu exame de aptidão para uso da piscina vence em ${fmtDateBR(validUntilIso)}. ` +
      `Por favor, renove com antecedência para manter o acesso. Obrigado.`
    );
  }

  function messageVencida(name) {
    const n = String(name || 'paciente').trim() || 'paciente';
    return (
      `Olá ${n}, identificamos que seu exame de aptidão está vencido. ` +
      `Entre em contato para renovar e regularizar o acesso. Obrigado.`
    );
  }

  function displayUserLabel(raw) {
    const s = String(raw || '').trim();
    if (!s) return 'Administrador';
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  if (sidebarName) {
    const disp = sessionStorage.getItem('clubAccessDisplayName');
    const u = sessionStorage.getItem('clubAccessUser');
    sidebarName.textContent = disp || displayUserLabel(u);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatCpfDigits(val) {
    return String(val || '').replace(/\D/g, '');
  }

  function formatCpfShow(digits) {
    const d = formatCpfDigits(digits);
    if (d.length !== 11) return d || '—';
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  function formatPhoneBR(raw) {
    const d = String(raw || '').replace(/\D/g, '').slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : '';
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function fmtDateBR(iso) {
    if (!iso) return '—';
    const s = String(iso).slice(0, 10);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return '—';
    return `${m[3]}/${m[2]}/${m[1]}`;
  }

  function fmtDateTimeBR(iso) {
    if (!iso) return '—';
    const t = Date.parse(String(iso));
    if (Number.isNaN(t)) return '—';
    const d = new Date(t);
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yyyy}, ${hh}:${mi}`;
  }

  function fmtTimeHms(iso) {
    if (!iso) return '—';
    const t = Date.parse(String(iso));
    if (Number.isNaN(t)) return '—';
    const d = new Date(t);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function fmtRelativeAgo(iso) {
    if (!iso) return '—';
    const t = Date.parse(String(iso));
    if (Number.isNaN(t)) return '—';
    const diff = Date.now() - t;
    if (diff < 45000) return 'agora';
    const min = Math.floor(diff / 60000);
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 48) return `há ${h} h`;
    const d = Math.floor(h / 24);
    return `há ${d} d`;
  }

  /** Retorna IPv4 normalizado (ex.: 192.168.0.67) ou null se inválido. */
  function normalizeDeviceIpv4(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
    if (!m) return null;
    const parts = [m[1], m[2], m[3], m[4]].map((x) => Number.parseInt(x, 10));
    if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return parts.join('.');
  }

  function normalizeDevicePort(raw) {
    const n = Number.parseInt(String(raw || '').trim(), 10);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    return n;
  }

  /** Parseia URL/IP do painel XPE → { ip, port, baseUrl } ou null. */
  function parseDeviceUrlToIpPort(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    let toParse = s;
    if (!/^[a-z]+:\/\//i.test(toParse)) {
      toParse = `http://${toParse}`;
    }
    try {
      const u = new URL(toParse);
      const ip = normalizeDeviceIpv4(u.hostname);
      if (!ip) return null;
      let port = Number.parseInt(u.port, 10);
      if (!Number.isInteger(port) || port < 1) {
        port = u.protocol === 'https:' ? 443 : 80;
      }
      const portPart = port === 80 || port === 443 ? '' : `:${port}`;
      const baseUrl = `${u.protocol}//${ip}${portPart}`;
      return { ip, port, baseUrl };
    } catch {
      const ip = normalizeDeviceIpv4(s);
      if (!ip) return null;
      return { ip, port: 80, baseUrl: `http://${ip}` };
    }
  }

  function buildDeviceUrlFromIpPort(ip, port) {
    const safeIp = normalizeDeviceIpv4(ip);
    if (!safeIp) return '';
    const p = normalizeDevicePort(port) ?? 80;
    return p === 80 ? `http://${safeIp}` : `http://${safeIp}:${p}`;
  }

  /** Sincroniza field-xpe-device-url ↔ IP/porta (source: 'url' | 'ip'). */
  function syncDeviceUrlAndIpFields(source) {
    const urlEl = document.getElementById('field-xpe-device-url');
    const ipEl = document.getElementById('field-device-ip');
    const portEl = document.getElementById('field-device-port');
    const baseEl = document.getElementById('field-xpe-open-door-base');
    if (!urlEl || !ipEl || !portEl) return;

    if (source === 'url') {
      const parsed = parseDeviceUrlToIpPort(urlEl.value);
      if (!parsed) return;
      ipEl.value = parsed.ip;
      portEl.value = String(parsed.port);
      if (baseEl && !String(baseEl.value || '').trim()) {
        baseEl.value = parsed.baseUrl;
      }
      return;
    }

    const built = buildDeviceUrlFromIpPort(ipEl.value, portEl.value);
    if (built) {
      urlEl.value = built;
      if (baseEl && !String(baseEl.value || '').trim()) {
        baseEl.value = built;
      }
    }
  }

  function syncOpenDoorCredsFromWebFields() {
    const webUser = String(document.getElementById('field-xpe-web-user')?.value || '').trim();
    const webPass = String(document.getElementById('field-xpe-web-password')?.value || '');
    const ou = document.getElementById('field-xpe-open-door-user');
    const op = document.getElementById('field-xpe-open-door-password');
    if (ou) ou.value = webUser;
    if (op) op.value = webPass;
  }

  function formatBytes(n) {
    const x = Number(n) || 0;
    if (x < 1024) return `${x} B`;
    if (x < 1048576) return `${(x / 1024).toFixed(1)} KB`;
    return `${(x / 1048576).toFixed(2)} MB`;
  }

  function donutBackground(valid, expiring, expired, blocked) {
    const t = valid + expiring + expired + blocked;
    if (t === 0) return 'conic-gradient(#334155 0deg 360deg)';
    let a = 0;
    const parts = [];
    const add = (c, color) => {
      if (c <= 0) return;
      const deg = (c / t) * 360;
      parts.push(`${color} ${a}deg ${a + deg}deg`);
      a += deg;
    };
    add(valid, '#22c55e');
    add(expiring, '#eab308');
    add(expired, '#ef4444');
    add(blocked, '#3b82f6');
    return `conic-gradient(${parts.join(', ')})`;
  }

  /** Explica erros típicos de socket do Node (TCP ao leitor). */
  function explainDeviceConnectionError(ip, port, rawErr) {
    const raw = String(rawErr || '');
    const bullets = [];
    let title = 'Falha de rede com o leitor';
    if (!ip || port == null) {
      title = 'IP ou porta não configurados';
      bullets.push('Abra Configurações e informe IPv4 com pontos e a porta indicada no equipamento.');
      return { title, detail: bullets.map((b) => `• ${b}`).join('\n') };
    }
    if (/ECONNREFUSED/i.test(raw)) {
      title = 'Conexão recusada nesta porta';
      bullets.push(`O endereço ${ip}:${port} foi contactado, mas nada aceitou TCP nessa porta.`);
      bullets.push(
        'Ou a porta está errada, ou não há serviço escutando aí. No XPE 3200 PLUS IP a interface web costuma ser HTTP porta 80 (pode ser diferente do que o InControl mostra).'
      );
      bullets.push(`No PowerShell: Test-NetConnection -ComputerName ${ip} -Port ${port}`);
      bullets.push('Consulte o manual: porta HTTP (ex.: 80/443) pode ser outra; firewall no PC ou no roteador pode bloquear.');
    } else if (/ETIMEDOUT|esgotado/i.test(raw)) {
      title = 'Tempo de conexão esgotado';
      bullets.push('O IP pode estar errado, o leitor desligado, fora da mesma rede ou bloqueado por firewall.');
      bullets.push(`Teste: ping ${ip} e depois Test-NetConnection -ComputerName ${ip} -Port ${port}.`);
    } else if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(raw)) {
      title = 'Endereço não resolvido';
      bullets.push('Confira se o IPv4 em Configurações está exatamente como na rede (ex.: 192.168.0.67).');
    } else if (/EHOSTUNREACH|ENETUNREACH/i.test(raw)) {
      title = 'Rede inacessível';
      bullets.push('Conecte o PC na mesma rede do leitor ou libere rota/VLAN até o IP do equipamento.');
    } else {
      bullets.push(raw.trim() || 'Erro sem classificação automática.');
      bullets.push(`Destino: ${ip}:${port}`);
    }
    return { title, detail: bullets.map((b) => `• ${b}`).join('\n') };
  }

  function extractTcpErrorFromCheck(full) {
    const s = String(full || '');
    const m = /(connect\s+[A-Z]+[^\n]*)/i.exec(s);
    if (m) return m[1].trim();
    return s.replace(/^Não foi possível conectar ao dispositivo\s*\([^)]+\)\.?\s*/i, '').trim() || s;
  }

  function alertDeviceConnectionFailure(ip, port, fullMessage) {
    const msg = String(fullMessage || '');
    if (/IP ou porta inválidos|IPv4 com pontos|192168067/i.test(msg)) {
      alert(
        'Configuração do leitor\n\n' +
          msg +
          '\n\nComo corrigir:\n' +
          '• IPv4 com pontos: 192.168.0.67 (não use 192168067).\n' +
          '• Porta: número entre 1 e 65535 (videoporteiro XPE 3200 PLUS IP: interface web costuma ser 80 — veja o manual).'
      );
      return;
    }
    const safeIp = ip != null ? ip : normalizeDeviceIpv4(loadDeviceSettings().ip);
    const safePort = port != null ? port : normalizeDevicePort(loadDeviceSettings().devicePort);
    const raw = extractTcpErrorFromCheck(msg);
    const adv = explainDeviceConnectionError(safeIp, safePort, raw);
    alert(`${adv.title}\n\n${adv.detail}\n\nDetalhe técnico: ${raw || '—'}`);
  }

  async function ensureDeviceOnline(settings, runtime) {
    const ip = normalizeDeviceIpv4(settings.ip);
    const port = normalizeDevicePort(settings.devicePort);
    if (!ip || port == null) {
      return {
        ok: false,
        ip: null,
        port: null,
        error:
          'IP ou porta inválidos. O IP deve ser IPv4 com pontos (ex.: 192.168.0.67), não 192168067.',
      };
    }
    const result = await window.clubAccess.deviceConnectivityCheck(ip, port, 2500);
    if (!result?.ok) {
      runtime.connected = false;
      saveDeviceRuntime(runtime);
      return {
        ok: false,
        ip,
        port,
        error: `Não foi possível conectar ao dispositivo (${ip}:${port}). ${result?.error || ''}`.trim(),
      };
    }
    runtime.connected = true;
    saveDeviceRuntime(runtime);
    return { ok: true, ip, port };
  }

  async function buildXpeSyncPayload(patientId) {
    const s = loadDeviceSettings();
    const ipFromForm = normalizeDeviceIpv4(document.getElementById('field-device-ip')?.value);
    const portFromForm = normalizeDevicePort(document.getElementById('field-device-port')?.value);
    const ip = ipFromForm || normalizeDeviceIpv4(s.ip);
    const port = portFromForm != null ? portFromForm : normalizeDevicePort(s.devicePort);
    let bridge = null;
    try {
      bridge = await window.clubAccess.xpeBridgeGetSettings();
    } catch {
      bridge = null;
    }

    let username = String(document.getElementById('field-xpe-web-user')?.value || '').trim();
    let password = String(document.getElementById('field-xpe-web-password')?.value || '');

    if (!username && bridge?.openDoorUser) {
      username = String(bridge.openDoorUser).trim();
    }

    if (!password && bridge?.hasOpenDoorPassword) {
      password = '';
    }

    return {
      patientId: Number(patientId),
      ip: ip || '',
      port: port != null ? port : 80,
      username,
      password,
    };
  }

  async function runXpeSyncForPatient(patientId, patientName) {
    const id = Number(patientId);
    if (!Number.isFinite(id) || id < 1) {
      alert('ID do paciente inválido.');
      return { ok: false };
    }

    const settings = loadDeviceSettings();
    const ip = normalizeDeviceIpv4(settings.ip);
    if (!ip) {
      alert('Configure o IP do XPE em Configurações antes de sincronizar.');
      return { ok: false };
    }

    const label = patientName ? `${patientName} (ID ${id})` : `ID ${id}`;
    const confirmed = window.confirm(
      `Sincronizar no Intelbras XPE via Playwright?\n\nPaciente: ${label}\n\nUma janela do navegador será aberta no equipamento.`
    );
    if (!confirmed) return { ok: false, cancelled: true };

    const payload = await buildXpeSyncPayload(id);
    let result = null;
    try {
      result = await window.clubAccess.xpeSyncUser(payload);
    } catch (e) {
      result = { ok: false, error: String(e?.message || e) };
    }

    if (result?.ok) {
      pushDeviceLog({
        type: 'ok',
        title: `Intelbras XPE — paciente ${id} cadastrado e confirmado na lista`,
        actor: 'Playwright',
      });
      alert(
        `Paciente ${label} enviado ao XPE.\n\nO ID ${id} foi encontrado na lista de usuários do equipamento.`
      );
    } else {
      pushDeviceLog({
        type: 'deny',
        title: `Falha na sincronização XPE — paciente ${id}`,
        actor: result?.error || 'Erro',
      });
      let msg = result?.error || 'Não foi possível sincronizar.';
      if (result?.screenshot) {
        msg += `\n\nScreenshot: ${result.screenshot}`;
      }
      alert(msg);
    }

    await refreshDeviceUI();
    return result;
  }

  let deviceSettingsFileCache = null;

  function mergeDeviceSettingsObject(o) {
    const merged = { ...DEFAULT_DEVICE_SETTINGS, ...o };
    if (merged.deviceName === 'Intelbras FR-3000') {
      merged.deviceName = DEFAULT_DEVICE_SETTINGS.deviceName;
    }
    if (!merged.systemName && merged.clubDisplayName) {
      merged.systemName = merged.clubDisplayName;
    }
    merged.examAllowedWeekdays = normalizeExamAllowedWeekdays(merged.examAllowedWeekdays);
    merged.colorTheme = merged.colorTheme === 'light' ? 'light' : 'dark';
    return merged;
  }

  function loadDeviceSettings() {
    if (deviceSettingsFileCache) {
      return mergeDeviceSettingsObject(deviceSettingsFileCache);
    }
    try {
      const raw = localStorage.getItem(DEVICE_SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_DEVICE_SETTINGS };
      return mergeDeviceSettingsObject(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_DEVICE_SETTINGS };
    }
  }

  async function hydrateDeviceSettingsFromMain() {
    try {
      const r = await window.clubAccess.deviceSettingsGet();
      if (r?.ok && r.settings) {
        deviceSettingsFileCache = r.settings;
        const merged = mergeDeviceSettingsObject(r.settings);
        localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(merged));
        return merged;
      }
    } catch {
      /* ignore */
    }
    return loadDeviceSettings();
  }

  function saveDeviceSettings(s) {
    const merged = mergeDeviceSettingsObject(s);
    deviceSettingsFileCache = merged;
    localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(merged));
    void window.clubAccess.deviceSettingsSet(merged).catch(() => {});
  }

  function loadDeviceRuntime() {
    try {
      const raw = localStorage.getItem(DEVICE_RUNTIME_KEY);
      if (!raw) {
        const init = {
          connected: false,
          lastSyncAt: null,
          lastSyncedCount: null,
          pendingPhotos: 0,
        };
        localStorage.setItem(DEVICE_RUNTIME_KEY, JSON.stringify(init));
        return init;
      }
      const o = JSON.parse(raw);
      return {
        connected: Boolean(o.connected),
        lastSyncAt: o.lastSyncAt || null,
        lastSyncedCount: o.lastSyncedCount != null ? Number(o.lastSyncedCount) : null,
        pendingPhotos: Math.max(0, Number(o.pendingPhotos) || 0),
      };
    } catch {
      return {
        connected: false,
        lastSyncAt: null,
        lastSyncedCount: null,
        pendingPhotos: 0,
      };
    }
  }

  function saveDeviceRuntime(r) {
    localStorage.setItem(DEVICE_RUNTIME_KEY, JSON.stringify(r));
  }

  function loadDeviceLogs() {
    try {
      const raw = localStorage.getItem(DEVICE_LOGS_KEY);
      if (!raw) return [];
      const a = JSON.parse(raw);
      return Array.isArray(a) ? a.slice(0, MAX_DEVICE_LOGS) : [];
    } catch {
      return [];
    }
  }

  function saveDeviceLogs(logs) {
    localStorage.setItem(DEVICE_LOGS_KEY, JSON.stringify(logs.slice(0, MAX_DEVICE_LOGS)));
  }

  function pushDeviceLog(entry) {
    const logs = loadDeviceLogs();
    const row = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type:
        entry.type === 'deny'
          ? 'deny'
          : entry.type === 'warn'
            ? 'warn'
            : entry.type === 'ok'
              ? 'ok'
              : 'info',
      title: String(entry.title || ''),
      actor: String(entry.actor || 'Sistema'),
      at: entry.at || new Date().toISOString(),
    };
    logs.unshift(row);
    saveDeviceLogs(logs.slice(0, MAX_DEVICE_LOGS));
    renderDeviceLogs();
  }

  function renderDeviceLogs() {
    const list = document.getElementById('device-logs-list');
    const empty = document.getElementById('device-logs-empty');
    if (!list || !empty) return;
    const logs = loadDeviceLogs();
    list.innerHTML = '';
    if (!logs.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    for (const row of logs) {
      const iconClass =
        row.type === 'ok'
          ? 'admin-device-log-item__icon--ok'
          : row.type === 'warn'
            ? 'admin-device-log-item__icon--warn'
            : row.type === 'deny'
              ? 'admin-device-log-item__icon--deny'
              : 'admin-device-log-item__icon--info';
      let svgInner;
      if (row.type === 'ok') {
        svgInner =
          '<polyline points="20 6 9 17 4 12" stroke-linecap="round" stroke-linejoin="round"/>';
      } else if (row.type === 'deny') {
        svgInner =
          '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
      } else if (row.type === 'warn') {
        svgInner =
          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
      } else {
        svgInner =
          '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>';
      }
      const li = document.createElement('li');
      li.className = 'admin-device-log-item';
      li.innerHTML = `
        <span class="admin-device-log-item__icon ${iconClass}" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svgInner}</svg>
        </span>
        <div class="admin-device-log-item__body">
          <p class="admin-device-log-item__title">${escapeHtml(row.title)}</p>
          <p class="admin-device-log-item__actor">${escapeHtml(row.actor)}</p>
        </div>
        <span class="admin-device-log-item__time">${escapeHtml(fmtTimeHms(row.at))}</span>
      `;
      list.appendChild(li);
    }
  }

  function applyBrandingFromSettings() {
    const s = loadDeviceSettings();
    const name =
      String(s.systemName || s.clubDisplayName || DEFAULT_DEVICE_SETTINGS.systemName).trim() || 'AquaAccess';
    const badgeEl = document.getElementById('topbar-club-badge');
    const sidebarEl = document.getElementById('sidebar-system-name');
    if (badgeEl) badgeEl.textContent = name;
    if (sidebarEl) sidebarEl.textContent = name;
    const theme = s.colorTheme === 'light' ? 'light' : 'dark';
    if (window.ClubAccessTheme?.applyColorTheme) {
      window.ClubAccessTheme.applyColorTheme(theme);
    }
  }

  let xpeWizardLanIp = null;

  function getPcLanIpFromField() {
    const raw = String(document.getElementById('field-pc-lan-ip')?.value || '').trim();
    const norm = normalizeDeviceIpv4(raw);
    return norm || xpeWizardLanIp || null;
  }

  function updateXpeBridgeUrlHint(lanIpOverride, exampleOverride) {
    const portEl = document.getElementById('field-xpe-bridge-port');
    const pathEl = document.getElementById('field-xpe-bridge-path');
    const port = String(portEl?.value || '37891').trim() || '37891';
    let pth = String(pathEl?.value || '/intelbras/xpe').trim() || '/intelbras/xpe';
    if (!pth.startsWith('/')) pth = `/${pth}`;
    const lan = lanIpOverride || getPcLanIpFromField() || xpeWizardLanIp || null;
    const example =
      exampleOverride ||
      (lan ? `http://${lan}:${port}${pth}?userId=123` : '—');
    const lanHint = document.getElementById('xpe-bridge-lan-hint');
    const exEl = document.getElementById('xpe-bridge-url-example');
    if (lanHint) lanHint.textContent = lan || 'defina o IP do PC acima';
    if (exEl) exEl.textContent = example || (lan ? `http://${lan}:${port}${pth}?userId=123` : '—');
    const actionField = document.getElementById('field-xpe-action-url');
    if (actionField && !actionField.dataset.userEdited) {
      const base = lan ? `http://${lan}:${port}${pth}` : '';
      if (base) actionField.value = base;
    }
  }

  function setXpeWizardStatus(message, kind = 'ok') {
    const el = document.getElementById('xpe-wizard-status');
    if (!el) return;
    if (!message) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = message;
    el.classList.remove('admin-xpe-wizard__status--warn', 'admin-xpe-wizard__status--err');
    if (kind === 'warn') el.classList.add('admin-xpe-wizard__status--warn');
    if (kind === 'err') el.classList.add('admin-xpe-wizard__status--err');
  }

  function setXpeChecklistState(key, state) {
    const el = document.getElementById(`xpe-check-${key}`);
    if (!el) return;
    el.classList.remove('admin-xpe-checklist__item--done', 'admin-xpe-checklist__item--pending');
    if (state === 'done') el.classList.add('admin-xpe-checklist__item--done');
    if (state === 'pending') el.classList.add('admin-xpe-checklist__item--pending');
  }

  function updateXpeSetupChecklist(data) {
    const actionUrl = String(document.getElementById('field-xpe-action-url')?.value || '').trim();
    const deviceUrl = String(document.getElementById('field-xpe-device-url')?.value || '').trim();
    const ipOk = Boolean(
      normalizeDeviceIpv4(document.getElementById('field-device-ip')?.value) ||
        parseDeviceUrlToIpPort(deviceUrl)?.ip
    );
    const portOk =
      normalizeDevicePort(document.getElementById('field-device-port')?.value) != null ||
      Boolean(parseDeviceUrlToIpPort(deviceUrl));
    const webUser = String(document.getElementById('field-xpe-web-user')?.value || '').trim();
    const lanOk = Boolean(getPcLanIpFromField());
    const bridgeOk = Boolean(data?.bridgeStatus?.enabled && data?.bridgeStatus?.listening);
    const probeOk = data?.probe?.ok === true;

    setXpeChecklistState('device', ipOk && portOk ? 'done' : ipOk || deviceUrl ? 'pending' : '');
    setXpeChecklistState('creds', webUser ? 'done' : '');
    setXpeChecklistState('lan', lanOk ? 'done' : '');
    setXpeChecklistState(
      'detect',
      bridgeOk || probeOk ? 'done' : ipOk || deviceUrl ? 'pending' : ''
    );
    setXpeChecklistState('paste', actionUrl ? 'pending' : '');
    setXpeChecklistState('users', bridgeOk || probeOk || actionUrl ? 'pending' : '');
    setXpeChecklistState('firewall', bridgeOk ? 'pending' : '');
  }

  function applyXpeDiscoverToWizard(data) {
    if (!data?.ok) return;
    xpeWizardLanIp =
      data.pcLanIp ||
      data.network?.preferredLanIp ||
      data.bridge?.preferredLanIp ||
      null;
    const lanField = document.getElementById('field-pc-lan-ip');
    const lanExtra = document.getElementById('xpe-wizard-lan-extra');
    if (lanField) {
      const cur = String(lanField.value || '').trim();
      if (!cur && xpeWizardLanIp) {
        lanField.value = xpeWizardLanIp;
      } else if (!cur) {
        lanField.placeholder = 'Não detectado — digite o IP deste PC na rede';
      }
    }
    if (lanExtra && Array.isArray(data.network?.addresses) && data.network.addresses.length > 0) {
      const all = data.network.addresses.map((a) => a.ip).join(', ');
      const auto = data.network?.autoDetectedLanIp;
      let hint = `Interfaces neste PC: ${all}`;
      if (auto && auto !== xpeWizardLanIp) {
        hint += ` · Sugestão automática (mesma rede do Intelbras): ${xpeWizardLanIp || auto}`;
      }
      lanExtra.textContent = hint;
      lanExtra.hidden = false;
    } else if (lanExtra) {
      lanExtra.hidden = true;
      lanExtra.textContent = '';
    }

    const urlField = document.getElementById('field-xpe-device-url');
    if (urlField && !urlField.value.trim()) {
      const fromInt = data.integration?.deviceUrl;
      const fromDev = data.deviceSettings?.ip
        ? `http://${data.deviceSettings.ip}:${data.deviceSettings.devicePort || 80}`
        : '';
      urlField.value = fromInt || fromDev || '';
    }
    if (urlField?.value.trim()) {
      syncDeviceUrlAndIpFields('url');
    } else if (data.deviceSettings?.ip) {
      const ipEl = document.getElementById('field-device-ip');
      const portEl = document.getElementById('field-device-port');
      if (ipEl && !ipEl.value.trim()) ipEl.value = data.deviceSettings.ip;
      if (portEl && !portEl.value.trim()) {
        portEl.value = String(data.deviceSettings.devicePort || '80');
      }
      syncDeviceUrlAndIpFields('ip');
    }

    const webUser = document.getElementById('field-xpe-web-user');
    if (webUser && !webUser.value.trim() && data.integration?.deviceWebUser) {
      webUser.value = data.integration.deviceWebUser;
    }

    const actionUrl = data.actionUrlLogAccess || '';
    const actionField = document.getElementById('field-xpe-action-url');
    if (actionField && actionUrl) {
      actionField.value = actionUrl;
      delete actionField.dataset.userEdited;
    }

    updateXpeBridgeUrlHint(xpeWizardLanIp, data.actionUrlExample);

    let statusMsg = '';
    if (data.probe?.summary) {
      statusMsg = data.probe.summary;
    }
    if (data.bridgeStatus?.enabled && data.bridgeStatus?.listening) {
      statusMsg = statusMsg
        ? `${statusMsg} Bridge HTTP ativo na porta ${data.bridgeStatus.port}.`
        : `Bridge HTTP ativo na porta ${data.bridgeStatus.port}.`;
    } else if (data.bridgeStatus?.enabled && !data.bridgeStatus?.listening) {
      statusMsg = statusMsg
        ? `${statusMsg} Bridge habilitado mas parado: ${data.bridgeStatus.lastStartError || 'verifique porta/firewall.'}`
        : `Bridge habilitado mas parado: ${data.bridgeStatus.lastStartError || 'verifique porta/firewall.'}`;
      setXpeWizardStatus(statusMsg, 'warn');
      updateXpeSetupChecklist(data);
      return;
    }
    if (statusMsg) {
      setXpeWizardStatus(statusMsg, data.probe?.ok === false ? 'warn' : 'ok');
    } else {
      setXpeWizardStatus('Informe a URL do Intelbras e clique em Detectar e configurar.', 'warn');
    }
    updateXpeSetupChecklist(data);
  }

  async function refreshXpeWizard() {
    try {
      const deviceUrl = String(document.getElementById('field-xpe-device-url')?.value || '').trim();
      const data = await window.clubAccess.xpeSetupDiscover(
        deviceUrl ? { deviceUrl } : {}
      );
      applyXpeDiscoverToWizard(data);
    } catch (e) {
      setXpeWizardStatus(String(e?.message || e), 'err');
    }
  }

  async function runXpeSetupApply() {
    let url = String(document.getElementById('field-xpe-device-url')?.value || '').trim();
    if (!url) {
      syncDeviceUrlAndIpFields('ip');
      url = String(document.getElementById('field-xpe-device-url')?.value || '').trim();
    }
    if (!url) {
      setXpeWizardStatus('Informe a URL ou o IP do painel Intelbras (ex.: http://192.168.0.67).', 'err');
      return;
    }
    syncDeviceUrlAndIpFields('url');
    const btn = document.getElementById('btn-xpe-setup-apply');
    if (btn) btn.disabled = true;
    setXpeWizardStatus('Detectando rede e testando o equipamento…', 'warn');
    try {
      const bridgePort = Number.parseInt(
        String(document.getElementById('field-xpe-bridge-port')?.value || '37891'),
        10
      );
      const bridgePath = String(
        document.getElementById('field-xpe-bridge-path')?.value || '/intelbras/xpe'
      ).trim();
      const r = await window.clubAccess.xpeSetupApply({
        deviceUrl: url,
        webUser: String(document.getElementById('field-xpe-web-user')?.value || '').trim(),
        webPassword: String(document.getElementById('field-xpe-web-password')?.value || ''),
        bridgePort: Number.isFinite(bridgePort) ? bridgePort : undefined,
        bridgePath: bridgePath || undefined,
        lanIp: getPcLanIpFromField() || undefined,
      });
      if (!r?.ok) {
        setXpeWizardStatus(r?.error || 'Falha na configuração.', 'err');
        return;
      }

      if (r.deviceSettings?.ip) {
        const prev = loadDeviceSettings();
        saveDeviceSettings({
          ...prev,
          ip: r.deviceSettings.ip,
          devicePort: String(r.deviceSettings.devicePort || '80'),
        });
      }

      const ipEl = document.getElementById('field-device-ip');
      const portEl = document.getElementById('field-device-port');
      if (ipEl && r.deviceSettings?.ip) ipEl.value = r.deviceSettings.ip;
      if (portEl && r.deviceSettings?.devicePort) portEl.value = r.deviceSettings.devicePort;
      syncDeviceUrlAndIpFields('ip');

      const baseEl = document.getElementById('field-xpe-open-door-base');
      if (baseEl && r.bridge?.openDoorBaseUrl) {
        baseEl.value = r.bridge.openDoorBaseUrl;
      } else if (baseEl && r.deviceSettings?.ip) {
        baseEl.value = buildDeviceUrlFromIpPort(
          r.deviceSettings.ip,
          r.deviceSettings.devicePort
        );
      }

      await fillXpeBridgeFromServer();

      const lanField = document.getElementById('field-pc-lan-ip');
      if (lanField && (r.pcLanIp || r.plan?.preferredLanIp)) {
        lanField.value = r.pcLanIp || r.plan.preferredLanIp;
        xpeWizardLanIp = lanField.value;
      }

      const actionField = document.getElementById('field-xpe-action-url');
      if (actionField && r.actionUrlLogAccess) {
        actionField.value = r.actionUrlLogAccess;
        delete actionField.dataset.userEdited;
      }

      const missingEl = document.getElementById('xpe-wizard-missing');
      if (missingEl && Array.isArray(r.missing) && r.missing.length) {
        missingEl.hidden = false;
        missingEl.textContent = `Ainda necessário: ${r.missing.join(' · ')}`;
      } else if (missingEl) {
        missingEl.hidden = true;
      }

      let msg = r.probe?.summary || 'Configuração aplicada.';
      if (r.bridge?.listening) {
        msg += ` Bridge na porta ${r.bridge.port}. Cole a URL em Log de Acesso no Intelbras.`;
      } else if (r.bridge?.bridgeStartError) {
        msg += ` Atenção: ${r.bridge.bridgeStartError}`;
      }
      setXpeWizardStatus(msg, r.bridge?.listening ? 'ok' : 'warn');
      updateXpeSetupChecklist({
        probe: r.probe,
        bridgeStatus: {
          enabled: true,
          listening: Boolean(r.bridge?.listening),
          port: r.bridge?.port,
          lastStartError: r.bridge?.bridgeStartError,
        },
        bridge: r.bridge,
      });

      await refreshXpeWizard();
      if (activePage === 'dispositivo') {
        void refreshDeviceUI();
      }
    } catch (e) {
      setXpeWizardStatus(String(e?.message || e), 'err');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function fillXpeBridgeFromServer() {
    try {
      const s = await window.clubAccess.xpeBridgeGetSettings();
      if (!s?.ok) return;
      const en = document.getElementById('toggle-xpe-bridge-enabled');
      const port = document.getElementById('field-xpe-bridge-port');
      const pth = document.getElementById('field-xpe-bridge-path');
      const sec = document.getElementById('field-xpe-bridge-secret');
      const odEn = document.getElementById('toggle-xpe-open-door');
      const base = document.getElementById('field-xpe-open-door-base');
      const ou = document.getElementById('field-xpe-open-door-user');
      const op = document.getElementById('field-xpe-open-door-password');
      const dn = document.getElementById('field-xpe-open-door-num');
      if (en) en.checked = Boolean(s.enabled);
      if (port) port.value = String(s.port ?? 37891);
      if (pth) pth.value = String(s.path || '/intelbras/xpe');
      if (sec) {
        sec.value = '';
        sec.placeholder = s.hasSharedSecret
          ? '(mantido — digite para trocar)'
          : 'Deixe em branco se o XPE não enviar token';
      }
      if (odEn) odEn.checked = Boolean(s.openDoorWhenGranted);
      if (base) base.value = String(s.openDoorBaseUrl || '');
      if (ou) ou.value = String(s.openDoorUser || '');
      if (op) op.value = '';
      if (dn) dn.value = String(s.openDoorNum || '1');
      const webUser = document.getElementById('field-xpe-web-user');
      if (webUser && s.openDoorUser) {
        webUser.value = String(s.openDoorUser);
      }
      const webPass = document.getElementById('field-xpe-web-password');
      if (webPass) {
        webPass.value = '';
        webPass.placeholder = s.hasOpenDoorPassword
          ? '(senha já salva — digite só se quiser trocar)'
          : 'Digite a senha e clique em Salvar';
      }
      const passStatus = document.getElementById('xpe-web-password-status');
      if (passStatus) {
        if (s.hasOpenDoorPassword) {
          passStatus.hidden = false;
          passStatus.textContent = 'Senha web gravada neste PC (não é exibida por segurança).';
        } else {
          passStatus.hidden = false;
          passStatus.textContent = 'Nenhuma senha salva ainda — preencha e clique em Salvar alterações.';
        }
      }
      const logChk = document.getElementById('toggle-xpe-bridge-log-inbound');
      if (logChk) logChk.checked = s.logInboundRequests !== false;
      try {
        const lp = await window.clubAccess.xpeBridgeInboundLogPath();
        const hint = document.getElementById('xpe-inbound-log-path-hint');
        if (hint && lp?.ok && lp.path) hint.textContent = lp.path;
      } catch {
        /* ignore */
      }
      xpeWizardLanIp = s.pcLanIp || s.preferredLanIp || s.detectedLanIp || xpeWizardLanIp;
      const lanField = document.getElementById('field-pc-lan-ip');
      if (lanField && !lanField.value.trim() && xpeWizardLanIp) {
        lanField.value = xpeWizardLanIp;
      }
      updateXpeBridgeUrlHint(xpeWizardLanIp, s.actionUrlExample);
      updateXpeSetupChecklist({
        bridgeStatus: {
          enabled: s.enabled,
          listening: undefined,
          port: s.port,
        },
        bridge: s,
      });
    } catch {
      /* ignore */
    }
  }

  function fillDeviceSettingsForm() {
    const s = loadDeviceSettings();
    const clubName = document.getElementById('field-club-name');
    const systemName = document.getElementById('field-system-name');
    const validityDays = document.getElementById('field-exam-validity-days');
    const deviceName = document.getElementById('field-device-name');
    const locationLabel = document.getElementById('field-location-label');
    const ip = document.getElementById('field-device-ip');
    const port = document.getElementById('field-device-port');
    const sync = document.getElementById('toggle-auto-sync');
    const blockExp = document.getElementById('toggle-block-expired');
    const n5 = document.getElementById('toggle-notify-5days');
    const denied = document.getElementById('toggle-notify-denied');
    const daily = document.getElementById('toggle-daily-email');
    const weekdayChecks = document.querySelectorAll('input[name="examAllowedWeekdays"]');
    if (clubName) clubName.value = s.clubName ?? '';
    if (systemName) systemName.value = s.systemName ?? '';
    if (deviceName) deviceName.value = s.deviceName ?? DEFAULT_DEVICE_SETTINGS.deviceName;
    if (locationLabel) locationLabel.value = s.locationLabel ?? DEFAULT_DEVICE_SETTINGS.locationLabel;
    if (validityDays) validityDays.value = String(s.defaultExamValidityDays ?? DEFAULT_DEVICE_SETTINGS.defaultExamValidityDays);
    if (ip) ip.value = s.ip || '';
    if (port) port.value = s.devicePort ?? '';
    if (s.ip) {
      const urlEl = document.getElementById('field-xpe-device-url');
      if (urlEl && !urlEl.value.trim()) {
        urlEl.value = buildDeviceUrlFromIpPort(s.ip, s.devicePort);
      }
    }
    if (sync) sync.checked = Boolean(s.autoSync5Min ?? DEFAULT_DEVICE_SETTINGS.autoSync5Min);
    if (blockExp) blockExp.checked = Boolean(s.blockExpiredExams ?? DEFAULT_DEVICE_SETTINGS.blockExpiredExams);
    if (n5) n5.checked = Boolean(s.notify5DaysBefore ?? DEFAULT_DEVICE_SETTINGS.notify5DaysBefore);
    if (denied) denied.checked = Boolean(s.notifyDeniedAccess ?? DEFAULT_DEVICE_SETTINGS.notifyDeniedAccess);
    if (daily) daily.checked = Boolean(s.dailyEmailSummary ?? DEFAULT_DEVICE_SETTINGS.dailyEmailSummary);
    weekdayChecks.forEach((el) => {
      const val = Number(el.value);
      el.checked = Array.isArray(s.examAllowedWeekdays) && s.examAllowedWeekdays.includes(val);
    });
    const theme = s.colorTheme === 'light' ? 'light' : 'dark';
    document.querySelectorAll('input[name="colorTheme"]').forEach((el) => {
      el.checked = el.value === theme;
    });
  }

  async function refreshDeviceUI() {
    const settings = loadDeviceSettings();
    const runtime = loadDeviceRuntime();
    const desc = document.getElementById('device-page-desc');
    const sumName = document.getElementById('device-summary-name');
    const statusWrap = document.getElementById('device-status-wrap');
    const statusLabel = document.getElementById('device-status-label');
    const mSync = document.getElementById('device-metric-last-sync');
    const mUsers = document.getElementById('device-metric-users');
    const mPhotos = document.getElementById('device-metric-photos');
    const subSync = document.getElementById('device-action-sync-sub');
    const subPhotos = document.getElementById('device-action-photos-sub');

    let patientTotal = 0;
    try {
      const rows = await window.clubAccess.patientsListOverview();
      if (Array.isArray(rows)) patientTotal = rows.length;
    } catch {
      patientTotal = 0;
    }

    const subtitle = `${settings.deviceName} — ${settings.locationLabel}`;
    if (desc) desc.textContent = subtitle;
    if (sumName) sumName.textContent = settings.deviceName || '—';

    const connected = runtime.connected;
    if (statusWrap) {
      statusWrap.classList.toggle('admin-device-status--ok', connected);
    }
    if (statusLabel) statusLabel.textContent = connected ? 'Conectado' : 'Desconectado';

    if (mSync) mSync.textContent = runtime.lastSyncAt ? fmtRelativeAgo(runtime.lastSyncAt) : '—';
    if (mUsers) {
      mUsers.textContent =
        runtime.lastSyncedCount != null && Number.isFinite(runtime.lastSyncedCount)
          ? String(runtime.lastSyncedCount)
          : '—';
    }
    const pendingVal = Math.max(runtime.pendingPhotos, 0);
    if (mPhotos) mPhotos.textContent = String(pendingVal);
    if (subSync) {
      subSync.textContent =
        patientTotal > 0
          ? `Exportar ${patientTotal} paciente(s) (fotos + manifesto CSV)`
          : 'Nenhum paciente cadastrado — exportação gera só o manifesto';
    }
    if (subPhotos) {
      subPhotos.textContent = 'Abrir última pasta de exportação';
    }

    const bridgeEl = document.getElementById('device-bridge-status');
    if (bridgeEl) {
      try {
        const st = await window.clubAccess.xpeBridgeGetStatus();
        if (st?.ok && st.enabled && st.listening) {
          bridgeEl.textContent = `Bridge HTTP ativo — porta ${st.port} (path ${st.path}).`;
        } else if (st?.ok && st.enabled && !st.listening) {
          bridgeEl.textContent = `Bridge habilitado mas parado: ${st.lastStartError || 'verifique a porta e o firewall.'}`;
        } else {
          bridgeEl.textContent = 'Bridge HTTP desligado — ative em Configurações para receber Log de Acesso do XPE.';
        }
      } catch {
        bridgeEl.textContent = 'Bridge HTTP: não foi possível obter o status.';
      }
    }

    renderDeviceLogs();
  }

  async function refreshDashboard() {
    const headDesc = document.getElementById('dash-head-desc');
    const monthlyWrap = document.getElementById('dash-monthly-chart');
    const monthlyEmpty = document.getElementById('dash-monthly-empty');
    const chartSummary = document.getElementById('dash-chart-summary');
    const donutEl = document.getElementById('dash-donut');
    const extraMeta = document.getElementById('dash-extra-meta');

    const setMeta = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text || '';
    };

    const setVal = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text != null ? String(text) : '—';
    };

    let snap = null;
    try {
      const res = await window.clubAccess.dashboardSnapshot();
      if (res?.ok && res.data) snap = res.data;
    } catch {
      snap = null;
    }

    if (!snap) {
      if (headDesc) headDesc.textContent = 'Não foi possível carregar os dados do painel.';
      return;
    }

    if (headDesc) {
      headDesc.textContent = 'Dados do banco local e teste de alcance do leitor (TCP) na rede';
    }

    setVal('dash-stat-patients', snap.totalPatients);
    setMeta(
      'dash-stat-patients-meta',
      snap.totalPatients === 0
        ? 'Nenhum paciente cadastrado ainda.'
        : snap.noExam > 0
          ? `Sem exame vigente: ${snap.noExam}`
          : 'Todos os pacientes têm situação de exame definida (local)'
    );

    setVal('dash-stat-valid', snap.examsValid);
    setMeta(
      'dash-stat-valid-meta',
      snap.examsExpiringWeek > 0
        ? `Com vencimento nesta semana: ${snap.examsExpiringWeek}`
        : 'Nenhum vencendo nesta semana'
    );

    setVal('dash-stat-expired', snap.examsExpired);
    setMeta('dash-stat-expired-meta', 'Exame vigente vencido (status no cadastro)');

    const acc = snap.accessToday || { total: 0, granted: 0, denied: 0 };
    setVal('dash-stat-access', acc.total);
    setMeta('dash-stat-access-meta', `${acc.granted} liberados · ${acc.denied} negados (hoje)`);

    let appVer = '';
    try {
      appVer = (await window.clubAccess.getAppVersion()) || '';
    } catch {
      appVer = '';
    }
    setVal('dash-stat-system', 'Operacional');
    setMeta(
      'dash-stat-system-meta',
      `${appVer ? `App v${appVer} · ` : ''}Banco ${formatBytes(snap.dbBytes)}${
        snap.pendingLocalPhotos > 0 ? ` · ${snap.pendingLocalPhotos} cadastro(s) sem foto` : ''
      }`
    );

    const validL = document.getElementById('dash-legend-valid');
    const expL = document.getElementById('dash-legend-expiring');
    const exdL = document.getElementById('dash-legend-expired');
    const blkL = document.getElementById('dash-legend-blocked');
    if (validL) validL.textContent = String(snap.examsValid);
    if (expL) expL.textContent = String(snap.examsExpiringWeek);
    if (exdL) exdL.textContent = String(snap.examsExpired);
    if (blkL) blkL.textContent = String(snap.blocked);

    if (donutEl) {
      donutEl.style.background = donutBackground(
        snap.examsValid,
        snap.examsExpiringWeek,
        snap.examsExpired,
        snap.blocked
      );
      donutEl.setAttribute(
        'aria-label',
        `Válidos ${snap.examsValid}, vencendo ${snap.examsExpiringWeek}, vencidos ${snap.examsExpired}, bloqueados ${snap.blocked}`
      );
    }

    if (extraMeta) {
      const parts = [];
      if (snap.noExam > 0) parts.push(`${snap.noExam} paciente(s) sem exame vigente.`);
      parts.push(
        'O cartão “Leitor facial (rede)” testa TCP. Fotos/CSV: Dispositivo facial → Exportar usuários. Regras de exame/bloqueio: bridge HTTP (Configurações) quando o XPE envia Log de Acesso.'
      );
      extraMeta.textContent = parts.join(' ');
    }

    const months = Array.isArray(snap.monthlyExams) ? snap.monthlyExams : [];
    const maxC = Math.max(1, ...months.map((m) => m.count));
    if (chartSummary) {
      const sum = months.reduce((s, m) => s + m.count, 0);
      chartSummary.textContent = `${sum} exame(s) nos últimos ${months.length} meses`;
    }
    if (monthlyWrap) {
      monthlyWrap.innerHTML = '';
      let totalM = 0;
      for (const m of months) {
        totalM += m.count;
        const col = document.createElement('div');
        col.className = 'admin-dash-monthly__col';
        const h = Math.round((m.count / maxC) * 130);
        col.innerHTML = `
          <div class="admin-dash-monthly__bar-wrap">
            <div class="admin-dash-monthly__bar" style="height:${Math.max(4, h)}px" title="${m.count} exames"></div>
          </div>
          <span class="admin-dash-monthly__count">${m.count}</span>
          <span class="admin-dash-monthly__label">${escapeHtml(m.label)}</span>
        `;
        monthlyWrap.appendChild(col);
      }
      if (monthlyEmpty) monthlyEmpty.hidden = totalM > 0;
    }

    const settings = loadDeviceSettings();
    const devIp = normalizeDeviceIpv4(settings.ip);
    const devPort = normalizeDevicePort(settings.devicePort);
    const deviceCard = document.getElementById('dash-device-card');
    const deviceVal = document.getElementById('dash-stat-device');
    const deviceMeta = document.getElementById('dash-stat-device-meta');
    const pill = document.getElementById('topbar-reader-pill');
    const pillLabel = document.getElementById('topbar-reader-label');

    deviceCard?.classList.remove('admin-stat-card--device-ok', 'admin-stat-card--device-bad', 'admin-stat-card--device-warn');
    pill?.classList.remove('admin-status-pill--ok', 'admin-status-pill--bad', 'admin-status-pill--warn', 'admin-status-pill--neutral');

    if (!devIp || devPort == null) {
      setVal('dash-stat-device', 'Não configurado');
      if (deviceMeta) {
        deviceMeta.textContent =
          'Defina IP (IPv4 com pontos) e porta em Configurações. O teste não foi executado.';
      }
      deviceCard?.classList.add('admin-stat-card--device-warn');
      pill?.classList.add('admin-status-pill--warn');
      if (pillLabel) pillLabel.textContent = 'Leitor: configure IP';
      return;
    }

    let probe = { ok: false, error: '' };
    try {
      probe = await window.clubAccess.deviceConnectivityCheck(devIp, devPort, 2500);
    } catch (e) {
      probe = { ok: false, error: String(e?.message || e) };
    }

    if (probe.ok) {
      setVal('dash-stat-device', 'Alcançável');
      if (deviceMeta) {
        deviceMeta.textContent = `TCP OK em ${devIp}:${devPort}. Isto não garante envio de fotos ao leitor; só confirma que a porta aceita conexão.`;
      }
      deviceCard?.classList.add('admin-stat-card--device-ok');
      pill?.classList.add('admin-status-pill--ok');
      if (pillLabel) pillLabel.textContent = `Leitor: OK · ${devPort}`;
    } else {
      setVal('dash-stat-device', 'Sem resposta');
      const adv = explainDeviceConnectionError(devIp, devPort, extractTcpErrorFromCheck(probe.error));
      if (deviceMeta) {
        deviceMeta.textContent = `${adv.title}. ${probe.error || ''}`.trim();
      }
      deviceCard?.classList.add('admin-stat-card--device-bad');
      pill?.classList.add('admin-status-pill--bad');
      if (pillLabel) pillLabel.textContent = 'Leitor: sem resposta';
    }
  }

  async function handleDeviceAction(action) {
    const runtime = loadDeviceRuntime();
    const settings = loadDeviceSettings();

    if (action === 'connect') {
      if (runtime.connected) {
        if (!confirm('Desconectar do dispositivo?')) return;
        runtime.connected = false;
        saveDeviceRuntime(runtime);
        pushDeviceLog({
          type: 'info',
          title: 'Dispositivo desconectado',
          actor: settings.deviceName || 'Leitor',
        });
      } else {
        const check = await ensureDeviceOnline(settings, runtime);
        if (!check.ok) {
          pushDeviceLog({
            type: 'deny',
            title: 'Falha ao conectar no dispositivo',
            actor: check.error || 'Sem resposta do dispositivo',
          });
          await refreshDeviceUI();
          alertDeviceConnectionFailure(check.ip ?? null, check.port ?? null, check.error);
          void refreshDashboard();
          return;
        }
        pushDeviceLog({
          type: 'ok',
          title: `Conexão estabelecida em ${check.ip}:${check.port}`,
          actor: settings.deviceName || 'Leitor',
        });
      }
      await refreshDeviceUI();
      void refreshDashboard();
      return;
    }

    if (action === 'sync') {
      let rows = [];
      try {
        rows = (await window.clubAccess.patientsListOverview()) || [];
      } catch {
        rows = [];
      }
      const list = Array.isArray(rows) ? rows : [];
      const n = list.length;
      let exp = null;
      try {
        exp = await window.clubAccess.xpeExportUserPack();
      } catch (e) {
        exp = { ok: false, error: String(e?.message || e) };
      }
      if (!exp?.ok) {
        alert(exp?.error || 'Não foi possível gerar a pasta de exportação para o XPE.');
        await refreshDeviceUI();
        return;
      }
      runtime.lastSyncAt = new Date().toISOString();
      runtime.lastSyncedCount = exp.patientCount != null ? exp.patientCount : n;
      runtime.pendingPhotos = Math.max(0, (exp.patientCount || n) - (exp.photosCopied || 0));
      saveDeviceRuntime(runtime);
      pushDeviceLog({
        type: 'info',
        title: `Exportação XPE — ${exp.photosCopied ?? 0} foto(s), ${exp.patientCount ?? n} paciente(s) → pasta no PC`,
        actor: 'Sistema',
      });
      await refreshDeviceUI();
      void refreshDashboard();
      const open = window.confirm(
        `Exportação salva em:\n${exp.folder}\n\nAbrir esta pasta no Explorador de Arquivos?`
      );
      if (open) {
        try {
          await window.clubAccess.xpeExportOpenLastFolder();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    if (action === 'xpe-sync') {
      const rawId = window.prompt(
        'ID do paciente no AquaAccess (mesmo número do ID Usuário no XPE):',
        ''
      );
      if (rawId === null) return;
      const patientId = Number(String(rawId).trim());
      if (!Number.isFinite(patientId) || patientId < 1) {
        alert('Informe um ID numérico válido.');
        return;
      }
      let p = null;
      try {
        p = await window.clubAccess.patientsGet(patientId);
      } catch {
        p = null;
      }
      if (!p) {
        alert('Paciente não encontrado.');
        return;
      }
      await runXpeSyncForPatient(patientId, String(p.full_name || '').trim());
      void refreshDashboard();
      return;
    }

    if (action === 'photos') {
      try {
        const r = await window.clubAccess.xpeExportOpenLastFolder();
        if (!r?.ok) {
          alert(r?.error || 'Nenhuma exportação nesta sessão. Use “Exportar usuários” primeiro.');
        }
      } catch (e) {
        alert(String(e?.message || e));
      }
      await refreshDeviceUI();
      return;
    }

    if (action === 'block') {
      const cpfRaw = window.prompt('CPF do usuário a bloquear (somente números):');
      if (cpfRaw === null) return;
      const digits = formatCpfDigits(cpfRaw);
      if (digits.length !== 11) {
        alert('Informe um CPF com 11 dígitos.');
        return;
      }
      let id = null;
      try {
        id = await window.clubAccess.patientsLookupCpf(digits);
      } catch {
        id = null;
      }
      if (!id) {
        alert('Nenhum paciente encontrado com este CPF.');
        return;
      }
      let p = null;
      try {
        p = await window.clubAccess.patientsGet(id);
      } catch {
        p = null;
      }
      if (!p) {
        alert('Paciente não encontrado.');
        return;
      }
      const name = String(p.full_name || '').trim() || '—';
      if (!window.confirm(`Bloquear o acesso de ${name}?`)) return;
      const res = await window.clubAccess.patientsSetBlocked(Number(id), true);
      if (!res?.ok) {
        alert(res?.error || 'Não foi possível bloquear.');
        return;
      }
      pushDeviceLog({
        type: 'warn',
        title: 'Usuário bloqueado manualmente',
        actor: name,
      });
      await refreshPacientesList();
      await refreshDeviceUI();
    }
  }

  /** Chave usada nos filtros da barra (alinhada aos pills). */
  function rowFilterKey(row) {
    if (row.blocked) return 'bloqueado';
    if (row.attention === 'vence_semana') return 'vencendo';
    return row.attention;
  }

  function statusMeta(row) {
    if (row.blocked) {
      return { label: 'Bloqueado', badgeClass: 'admin-status-badge--bloqueado' };
    }
    switch (String(row.attention || '')) {
      case 'valido':
        return { label: 'Válido', badgeClass: 'admin-status-badge--valido' };
      case 'vence_semana':
        return { label: 'Vencendo', badgeClass: 'admin-status-badge--vencendo' };
      case 'vencido':
        return { label: 'Vencido', badgeClass: 'admin-status-badge--vencido' };
      case 'sem_exame':
      default:
        return { label: 'Sem exame', badgeClass: 'admin-status-badge--sem-exame' };
    }
  }

  function getFilteredPacientes() {
    const q = pacientesSearchQ.trim().toLowerCase();
    const qDigits = formatCpfDigits(pacientesSearchQ);
    return pacientesCache.filter((row) => {
      if (pacientesFilter !== 'todos' && rowFilterKey(row) !== pacientesFilter) {
        return false;
      }
      if (!q && !qDigits) return true;
      const name = String(row.full_name || '').toLowerCase();
      const cpf = formatCpfDigits(row.cpf);
      if (name.includes(q)) return true;
      if (qDigits.length >= 3 && cpf.includes(qDigits)) return true;
      return false;
    });
  }

  async function renderPacientesTable() {
    if (!pacientesTbody || !pacientesEmpty) return;
    const rows = getFilteredPacientes();
    pacientesTbody.innerHTML = '';
    if (!rows.length) {
      pacientesEmpty.hidden = false;
      pacientesEmpty.textContent =
        pacientesCache.length === 0
          ? 'Nenhum paciente cadastrado.'
          : 'Nenhum paciente encontrado.';
      return;
    }
    pacientesEmpty.hidden = true;

    for (const row of rows) {
      const meta = statusMeta(row);
      const photoUrl = row.photo_path
        ? await window.clubAccess.toFileUrl(String(row.photo_path))
        : '';
      const tr = document.createElement('tr');
      const lastIn = row.last_access_at ? fmtDateTimeBR(row.last_access_at) : '—';
      const blockTitle = row.blocked ? 'Desbloquear' : 'Bloquear';
      const idNum = Number(row.id);
      tr.innerHTML = `
        <td>
          <div class="admin-paciente-cell">
            <img class="admin-paciente-cell__avatar" src="${photoUrl || '../public/icons_login/user.png'}" width="40" height="40" alt="" loading="lazy" />
            <div class="admin-paciente-cell__meta">
              <p class="admin-paciente-cell__name">${escapeHtml(row.full_name || '—')}</p>
              <p class="admin-paciente-cell__id">PAC-${String(idNum)}</p>
            </div>
          </div>
        </td>
        <td>${escapeHtml(formatCpfShow(row.cpf))}</td>
        <td class="admin-cell-muted">${lastIn === '—' ? '—' : escapeHtml(lastIn)}</td>
        <td>${escapeHtml(fmtDateBR(row.valid_until))}</td>
        <td>
          <span class="admin-status-badge ${meta.badgeClass}">
            <span class="admin-status-badge__dot" aria-hidden="true"></span>
            ${escapeHtml(meta.label)}
          </span>
        </td>
        <td class="admin-data-table__col-actions">
          <div class="admin-row-actions">
            <button type="button" class="admin-row-action" data-action="xpe-sync" data-id="${idNum}" title="Sincronizar Intelbras" aria-label="Sincronizar Intelbras">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
            <button type="button" class="admin-row-action admin-row-action--block" data-action="block" data-id="${idNum}" title="${escapeHtml(blockTitle)}" aria-label="${escapeHtml(blockTitle)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
              </svg>
            </button>
            <button type="button" class="admin-row-action admin-row-action--danger" data-action="delete" data-id="${idNum}" title="Deletar" aria-label="Deletar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
            <button type="button" class="admin-row-action" data-action="edit" data-id="${idNum}" title="Editar" aria-label="Editar">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          </div>
        </td>
      `;
      pacientesTbody.appendChild(tr);
    }
  }

  async function refreshPacientesList() {
    try {
      pacientesCache = await window.clubAccess.patientsListOverview();
    } catch {
      pacientesCache = [];
    }
    await renderPacientesTable();
  }

  function examStatusBadgeMeta(statusRaw) {
    const st = String(statusRaw || '').toLowerCase();
    const label = String(statusRaw || '—').trim() || '—';
    if (st === 'válido' || st === 'valido') {
      return { badgeClass: 'admin-status-badge--valido', label };
    }
    if (st === 'substituído' || st === 'substituido') {
      return { badgeClass: 'admin-status-badge--bloqueado', label };
    }
    return { badgeClass: 'admin-status-badge--sem-exame', label };
  }

  function renderExamsTable() {
    if (!adminTbodyExames || !adminExamesEmpty) return;
    const rows = examsCache;
    const rawQ = getTopbarQuery();
    const q = rawQ.toLowerCase();
    const filtered = q
      ? rows.filter((r) => {
          const blob = [r.patient_name, r.patient_cpf, r.status, r.exam_date, r.valid_until]
            .join(' ')
            .toLowerCase();
          return blob.includes(q);
        })
      : rows;

    adminTbodyExames.innerHTML = '';
    if (!filtered.length) {
      adminExamesEmpty.hidden = false;
      adminExamesEmpty.textContent =
        rows.length > 0 ? 'Nenhum resultado para a busca.' : 'Nenhum exame registrado ainda.';
      return;
    }
    adminExamesEmpty.hidden = true;

    for (const r of filtered) {
      const meta = examStatusBadgeMeta(r.status);
      const examId = Number(r.id);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(fmtDateBR(r.exam_date))}</td>
        <td>${escapeHtml(fmtDateBR(r.valid_until))}</td>
        <td>${escapeHtml(r.patient_name || '—')}</td>
        <td>${escapeHtml(formatCpfShow(r.patient_cpf))}</td>
        <td>
          <span class="admin-status-badge ${meta.badgeClass}">
            <span class="admin-status-badge__dot" aria-hidden="true"></span>
            ${escapeHtml(meta.label)}
          </span>
        </td>
        <td class="admin-data-table__col-actions">
          <div class="admin-row-actions">
            <button type="button" class="admin-row-action admin-row-action--danger" data-exam-delete="${examId}" title="Excluir registro" aria-label="Excluir registro de exame">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                <line x1="10" y1="11" x2="10" y2="17" />
                <line x1="14" y1="11" x2="14" y2="17" />
              </svg>
            </button>
          </div>
        </td>
      `;
      adminTbodyExames.appendChild(tr);
    }
  }

  async function loadExamsList() {
    if (adminExamesFeedback) {
      adminExamesFeedback.hidden = true;
    }
    try {
      examsCache = (await window.clubAccess.examsList()) || [];
    } catch {
      examsCache = [];
    }
    renderExamsTable();
  }

  function setFilterPillActive(value) {
    filterPills.forEach((btn) => {
      const on = btn.dataset.filter === value;
      btn.classList.toggle('admin-filter-pill--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function syncAdminModalBodyClass() {
    const anyVisible =
      (modalEdit && !modalEdit.hidden) ||
      (modalPacienteConfirm && !modalPacienteConfirm.hidden) ||
      (modalPacienteAlert && !modalPacienteAlert.hidden);
    document.body.classList.toggle('admin-modal-open', Boolean(anyVisible));
  }

  function openPacienteConfirm({ title, message, confirmText = 'Confirmar', danger = false }) {
    return new Promise((resolve) => {
      pacienteConfirmResolve = resolve;
      if (modalPacienteConfirmTitle) modalPacienteConfirmTitle.textContent = title;
      if (modalPacienteConfirmDesc) modalPacienteConfirmDesc.textContent = message;
      if (modalPacienteConfirmOk) {
        modalPacienteConfirmOk.textContent = confirmText;
        modalPacienteConfirmOk.classList.remove('admin-modal__btn--primary', 'admin-modal__btn--danger');
        modalPacienteConfirmOk.classList.add(danger ? 'admin-modal__btn--danger' : 'admin-modal__btn--primary');
      }
      if (modalPacienteConfirm) modalPacienteConfirm.hidden = false;
      syncAdminModalBodyClass();
      modalPacienteConfirmOk?.focus();
    });
  }

  function finishPacienteConfirm(value) {
    if (modalPacienteConfirm) modalPacienteConfirm.hidden = true;
    const fn = pacienteConfirmResolve;
    pacienteConfirmResolve = null;
    syncAdminModalBodyClass();
    if (fn) fn(value);
  }

  function openPacienteAlert({ title, message }) {
    return new Promise((resolve) => {
      pacienteAlertResolve = resolve;
      if (modalPacienteAlertTitle) modalPacienteAlertTitle.textContent = title;
      if (modalPacienteAlertDesc) modalPacienteAlertDesc.textContent = message;
      if (modalPacienteAlert) modalPacienteAlert.hidden = false;
      syncAdminModalBodyClass();
      modalPacienteAlertOk?.focus();
    });
  }

  function finishPacienteAlert() {
    if (modalPacienteAlert) modalPacienteAlert.hidden = true;
    const fn = pacienteAlertResolve;
    pacienteAlertResolve = null;
    syncAdminModalBodyClass();
    if (fn) fn();
  }

  modalPacienteConfirmBackdrop?.addEventListener('click', () => finishPacienteConfirm(false));
  modalPacienteConfirmCancel?.addEventListener('click', () => finishPacienteConfirm(false));
  modalPacienteConfirmOk?.addEventListener('click', () => finishPacienteConfirm(true));

  document.getElementById('view-exames')?.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-exam-delete]');
    if (!btn) return;
    e.preventDefault();
    const examId = Number(btn.getAttribute('data-exam-delete'));
    if (!examId) return;
    const confirmed = await openPacienteConfirm({
      title: 'Excluir exame',
      message:
        'Este registro será removido do histórico de exames realizados. O cadastro do paciente não será apagado.',
      confirmText: 'Excluir',
      danger: true,
    });
    if (!confirmed) return;
    if (adminExamesFeedback) adminExamesFeedback.hidden = true;
    const res = await window.clubAccess.examsDelete(examId);
    if (res.ok) {
      await loadExamsList();
      return;
    }
    if (adminExamesFeedback) {
      adminExamesFeedback.textContent = res.error || 'Não foi possível excluir o exame.';
      adminExamesFeedback.hidden = false;
    }
  });

  modalPacienteAlertBackdrop?.addEventListener('click', finishPacienteAlert);
  modalPacienteAlertOk?.addEventListener('click', finishPacienteAlert);

  function openEditModal() {
    if (!modalEdit) return;
    modalEdit.hidden = false;
    if (editPatientMsg) editPatientMsg.hidden = true;
    syncAdminModalBodyClass();
  }

  function closeEditModal() {
    if (!modalEdit) return;
    modalEdit.hidden = true;
    syncAdminModalBodyClass();
  }

  pacientesSearch?.addEventListener('input', () => {
    pacientesSearchQ = pacientesSearch.value;
    renderPacientesTable();
  });

  filterPills.forEach((btn) => {
    btn.addEventListener('click', () => {
      pacientesFilter = btn.dataset.filter || 'todos';
      setFilterPillActive(pacientesFilter);
      renderPacientesTable();
    });
  });

  pacientesTbody?.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const id = Number(btn.dataset.id);
    if (!Number.isFinite(id) || id <= 0) return;

    if (action === 'delete') {
      const confirmed = await openPacienteConfirm({
        title: 'Excluir paciente',
        message:
          'Esta ação é permanente. O cadastro e o histórico de exames deste paciente serão removidos e não poderão ser recuperados.',
        confirmText: 'Excluir',
        danger: true,
      });
      if (!confirmed) return;
      const res = await window.clubAccess.patientsDelete(id);
      if (!res?.ok) {
        await openPacienteAlert({
          title: 'Não foi possível excluir',
          message: res?.error || 'Tente novamente.',
        });
        return;
      }
      await refreshPacientesList();
      return;
    }

    if (action === 'xpe-sync') {
      const row = pacientesCache.find((r) => Number(r.id) === id);
      const name = String(row?.full_name || '').trim();
      btn.disabled = true;
      try {
        await runXpeSyncForPatient(id, name);
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (action === 'block') {
      const row = pacientesCache.find((r) => Number(r.id) === id);
      const next = !row?.blocked;
      const confirmed = await openPacienteConfirm({
        title: next ? 'Bloquear paciente' : 'Desbloquear paciente',
        message: next
          ? 'O paciente será marcado como bloqueado no sistema e poderá ser tratado conforme as regras de acesso.'
          : 'O paciente deixará de constar como bloqueado. As demais regras de exame continuam valendo.',
        confirmText: next ? 'Bloquear' : 'Desbloquear',
        danger: false,
      });
      if (!confirmed) return;
      const res = await window.clubAccess.patientsSetBlocked(id, next);
      if (!res?.ok) {
        await openPacienteAlert({
          title: 'Não foi possível atualizar',
          message: res?.error || 'Tente novamente.',
        });
        return;
      }
      await refreshPacientesList();
      return;
    }

    if (action === 'edit') {
      let p = null;
      try {
        p = await window.clubAccess.patientsGet(id);
      } catch {
        p = null;
      }
      if (!p) {
        await openPacienteAlert({
          title: 'Paciente não encontrado',
          message: 'Atualize a lista ou tente novamente.',
        });
        return;
      }
      fieldEditId.value = String(id);
      fieldEditName.value = String(p.full_name || '');
      fieldEditCpf.value = formatCpfShow(p.cpf);
      fieldEditPhone.value = formatPhoneBR(p.phone || '');
      openEditModal();
      fieldEditName?.focus();
    }
  });

  modalEditBackdrop?.addEventListener('click', closeEditModal);
  modalEditCancel?.addEventListener('click', closeEditModal);

  formEditPatient?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (editPatientMsg) editPatientMsg.hidden = true;
    const pid = Number(fieldEditId?.value || 0);
    if (!Number.isFinite(pid) || pid <= 0) {
      if (editPatientMsg) {
        editPatientMsg.textContent = 'Paciente inválido. Abra a edição novamente.';
        editPatientMsg.hidden = false;
      } else {
        await openPacienteAlert({
          title: 'Erro',
          message: 'Paciente inválido. Abra a edição novamente.',
        });
      }
      return;
    }
    const fullName = String(fieldEditName?.value || '').trim();
    const cpf = fieldEditCpf?.value || '';
    const phone = fieldEditPhone?.value || '';
    const res = await window.clubAccess.patientsUpdate({
      id: pid,
      fullName,
      cpf,
      phone,
    });
    if (!res?.ok) {
      const err = res?.error || 'Não foi possível salvar.';
      if (editPatientMsg) {
        editPatientMsg.textContent = err;
        editPatientMsg.hidden = false;
      } else {
        await openPacienteAlert({ title: 'Não foi possível salvar', message: err });
      }
      return;
    }
    closeEditModal();
    await refreshPacientesList();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (modalPacienteConfirm && !modalPacienteConfirm.hidden) {
      e.preventDefault();
      finishPacienteConfirm(false);
      return;
    }
    if (modalPacienteAlert && !modalPacienteAlert.hidden) {
      e.preventDefault();
      finishPacienteAlert();
      return;
    }
    if (modalEdit && !modalEdit.hidden) {
      closeEditModal();
      return;
    }
  });

  function setReportKpiCardsActive() {
    document.querySelectorAll('[data-report-kpi]').forEach((btn) => {
      const on = btn.getAttribute('data-report-kpi') === reportKpi;
      btn.classList.toggle('admin-reports__kpi-card--active', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function updateReportPanelCopy() {
    const titleEl = document.getElementById('reports-panel-title');
    const leadEl = document.getElementById('reports-panel-lead');
    if (!titleEl || !leadEl) return;

    if (reportKpi === 'vencendo') {
      titleEl.textContent = 'Exames vencendo no período';
      leadEl.textContent =
        'Pacientes com validade entre hoje e o fim do período selecionado. Envie lembrete pelo WhatsApp.';
    } else if (reportKpi === 'vencidas') {
      titleEl.textContent = 'Pessoas com exame vencido (no período)';
      leadEl.textContent =
        'Pacientes cuja data de validade terminou dentro do intervalo inicial/final. Convide à renovação pelo WhatsApp.';
    } else if (reportKpi === 'realizados') {
      titleEl.textContent = 'Exames realizados';
      leadEl.textContent =
        'Total de registros de exame cuja data cai no período. Para avisar pacientes, use o indicador Exames vencendo.';
    } else {
      titleEl.textContent = 'Entradas liberadas';
      leadEl.textContent =
        'Total de acessos concedidos pela catraca no período. Liste pacientes em Exames vencendo ou Pessoas vencidas.';
    }
  }

  function renderReportsKpiNumbers() {
    const s = reportSummaryCache;
    const elExames = document.getElementById('reports-kpi-exames');
    const elVen = document.getElementById('reports-kpi-vencendo');
    const elEnt = document.getElementById('reports-kpi-entradas');
    const elVenc = document.getElementById('reports-kpi-vencidas');
    const hint = document.getElementById('reports-blocked-hint');
    if (elExames) elExames.textContent = s ? String(s.examsDone ?? 0) : '—';
    if (elVen) elVen.textContent = s ? String(s.expiringInPeriod ?? 0) : '—';
    if (elEnt) elEnt.textContent = s ? String(s.entriesInPeriod ?? 0) : '—';
    if (elVenc) elVenc.textContent = s ? String(s.expiredInPeriod ?? 0) : '—';
    if (hint) {
      const blocked = s?.blockedTotal ?? 0;
      const totalExpired = s?.expiredTotal ?? 0;
      hint.innerHTML =
        `<strong>${blocked}</strong> usuário${blocked === 1 ? '' : 's'} bloqueado${blocked === 1 ? '' : 's'} no sistema · ` +
        `<strong>${totalExpired}</strong> com exame vencido no total (todas as datas)`;
    }
  }

  function renderReportsTable() {
    const tbody = document.getElementById('reports-tbody');
    const empty = document.getElementById('reports-empty');
    const tableWrap = tbody?.closest('.admin-reports__table-wrap');
    if (!tbody || !empty) return;

    tbody.innerHTML = '';
    updateReportPanelCopy();

    if (reportKpi === 'realizados') {
      const n = reportSummaryCache?.examsDone ?? 0;
      empty.hidden = false;
      empty.textContent = `Total no período: ${n} exame${n === 1 ? '' : 's'} registrado${n === 1 ? '' : 's'}.`;
      if (tableWrap) tableWrap.hidden = true;
      return;
    }
    if (reportKpi === 'entradas') {
      const n = reportSummaryCache?.entriesInPeriod ?? 0;
      empty.hidden = false;
      empty.textContent = `Total no período: ${n} entrada${n === 1 ? '' : 's'} liberada${n === 1 ? '' : 's'}.`;
      if (tableWrap) tableWrap.hidden = true;
      return;
    }

    if (tableWrap) tableWrap.hidden = false;

    const rows = Array.isArray(reportRowsCache) ? reportRowsCache : [];
    if (!rows.length) {
      empty.hidden = false;
      empty.textContent = 'Nenhum paciente neste indicador para o período selecionado.';
      return;
    }

    empty.hidden = true;
    const useVencidaMsg = reportKpi === 'vencidas';

    for (const row of rows) {
      const phone = row.phone;
      const hasPhone = Boolean(String(phone || '').replace(/\D/g, '').length >= 10);
      const body = useVencidaMsg
        ? messageVencida(row.full_name)
        : messageVencendo(row.full_name, row.valid_until);
      const url = hasPhone ? buildWhatsAppUrl(phone, body) : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.full_name || '—')}</td>
        <td>${escapeHtml(formatCpfShow(row.cpf))}</td>
        <td>${escapeHtml(row.exam_label || 'Exame de aptidão')}</td>
        <td>${escapeHtml(fmtDateBR(row.valid_until))}</td>
        <td>${escapeHtml(hasPhone ? formatPhoneBR(phone) : '—')}</td>
        <td class="admin-data-table__col-actions"></td>
      `;
      const tdWa = tr.querySelector('.admin-data-table__col-actions');
      const waBtn = document.createElement('button');
      waBtn.type = 'button';
      waBtn.className = 'admin-reports__wa-btn';
      waBtn.title = 'Abrir WhatsApp';
      waBtn.setAttribute('aria-label', 'WhatsApp');
      waBtn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';
      if (!hasPhone || !url) {
        waBtn.disabled = true;
      } else {
        waBtn.addEventListener('click', () => window.open(url, '_blank', 'noopener,noreferrer'));
      }
      if (tdWa) tdWa.appendChild(waBtn);
      tbody.appendChild(tr);
    }
  }

  async function loadReportRows() {
    const startEl = document.getElementById('reports-period-start');
    const endEl = document.getElementById('reports-period-end');
    const def = defaultReportPeriod();
    const periodStart = startEl?.value || def.start;
    const periodEnd = endEl?.value || def.end;

    if (reportKpi === 'realizados' || reportKpi === 'entradas') {
      reportRowsCache = [];
      renderReportsTable();
      return;
    }

    const kind = reportKpi === 'vencidas' ? 'vencidas' : 'vencendo';
    try {
      reportRowsCache = (await window.clubAccess.reportsRows(kind, periodStart, periodEnd)) || [];
    } catch {
      reportRowsCache = [];
    }
    renderReportsTable();
  }

  async function refreshReports() {
    const startEl = document.getElementById('reports-period-start');
    const endEl = document.getElementById('reports-period-end');
    if (!startEl || !endEl) return;

    const def = defaultReportPeriod();
    if (!startEl.value) startEl.value = def.start;
    if (!endEl.value) endEl.value = def.end;

    const periodStart = startEl.value;
    const periodEnd = endEl.value;

    try {
      reportSummaryCache = await window.clubAccess.reportsSummary(periodStart, periodEnd);
    } catch {
      reportSummaryCache = null;
    }
    renderReportsKpiNumbers();
    await loadReportRows();
    updateReportQuickActiveState();
  }

  function exportReportsCsv() {
    const headers = ['Paciente', 'CPF', 'Exame', 'Validade', 'Telefone', 'WhatsApp'];
    let lines = [headers.join(';')];

    if (reportKpi === 'realizados') {
      lines.push(`"Total exames no período";${reportSummaryCache?.examsDone ?? 0};;;;`);
    } else if (reportKpi === 'entradas') {
      lines.push(`"Total entradas no período";${reportSummaryCache?.entriesInPeriod ?? 0};;;;`);
    } else {
      const useVencida = reportKpi === 'vencidas';
      for (const row of reportRowsCache) {
        const phone = String(row.phone || '').replace(/\D/g, '');
        const body = useVencida ? messageVencida(row.full_name) : messageVencendo(row.full_name, row.valid_until);
        const url = phone.length >= 10 ? buildWhatsAppUrl(row.phone, body) : '';
        lines.push(
          [
            `"${String(row.full_name || '').replace(/"/g, '""')}"`,
            formatCpfDigits(row.cpf),
            `"${String(row.exam_label || '').replace(/"/g, '""')}"`,
            row.valid_until || '',
            phone,
            url ? `"${url.replace(/"/g, '""')}"` : '',
          ].join(';')
        );
      }
    }

    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `relatorio-${reportKpi}-${formatIsoLocal(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportReportsPdf() {
    const title =
      reportKpi === 'vencendo'
        ? 'Exames vencendo'
        : reportKpi === 'vencidas'
          ? 'Pessoas com exame vencido'
          : reportKpi === 'realizados'
            ? 'Exames realizados'
            : 'Entradas liberadas';

    let tableHtml = '';
    if (reportKpi === 'realizados') {
      tableHtml = `<p>${reportSummaryCache?.examsDone ?? 0} exame(s) no período.</p>`;
    } else if (reportKpi === 'entradas') {
      tableHtml = `<p>${reportSummaryCache?.entriesInPeriod ?? 0} entrada(s) no período.</p>`;
    } else {
      const useVencida = reportKpi === 'vencidas';
      const rowHtml = reportRowsCache
        .map((row) => {
          const body = useVencida ? messageVencida(row.full_name) : messageVencendo(row.full_name, row.valid_until);
          const url =
            String(row.phone || '').replace(/\D/g, '').length >= 10
              ? buildWhatsAppUrl(row.phone, body)
              : '';
          return `<tr>
            <td>${escapeHtml(row.full_name || '—')}</td>
            <td>${escapeHtml(formatCpfShow(row.cpf))}</td>
            <td>${escapeHtml(fmtDateBR(row.valid_until))}</td>
            <td>${escapeHtml(formatPhoneBR(row.phone))}</td>
            <td>${url ? escapeHtml(url) : '—'}</td>
          </tr>`;
        })
        .join('');
      tableHtml =
        `<table class="admin-reports-print-table">
          <thead><tr><th>Paciente</th><th>CPF</th><th>Validade</th><th>Telefone</th><th>Link WhatsApp</th></tr></thead>
          <tbody>${rowHtml || '<tr><td colspan="5">Nenhum registro.</td></tr>'}</tbody>
        </table>`;
    }

    const wrap = document.createElement('div');
    wrap.className = 'admin-reports__print-area';
    wrap.innerHTML = `
      <h1>${escapeHtml(title)}</h1>
      <p>Período: ${escapeHtml(fmtDateBR(document.getElementById('reports-period-start')?.value))} a ${escapeHtml(fmtDateBR(document.getElementById('reports-period-end')?.value))}</p>
      ${tableHtml}
    `;
    document.body.appendChild(wrap);
    window.print();
    wrap.remove();
  }

  document.getElementById('reports-apply-filters')?.addEventListener('click', () => {
    void refreshReports();
  });

  document.getElementById('reports-quick-week')?.addEventListener('click', () => applyReportsQuickPreset('week'));
  document.getElementById('reports-quick-month')?.addEventListener('click', () => applyReportsQuickPreset('month'));

  document.querySelectorAll('[data-report-kpi]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const next = btn.getAttribute('data-report-kpi');
      if (!next || next === reportKpi) return;
      reportKpi = next;
      setReportKpiCardsActive();
      await loadReportRows();
      updateReportQuickActiveState();
    });
  });

  document.getElementById('reports-export-csv')?.addEventListener('click', () => exportReportsCsv());
  document.getElementById('reports-export-pdf')?.addEventListener('click', () => exportReportsPdf());

  function clearNavActive() {
    navBtns.forEach((btn) => {
      btn.classList.remove('admin-nav-item--active');
      btn.setAttribute('aria-current', 'false');
    });
  }

  function formatBytes(n) {
    const x = Number(n) || 0;
    if (x < 1024) return `${x} B`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(x < 10 * 1024 ? 1 : 0)} KB`;
    return `${(x / (1024 * 1024)).toFixed(x < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  }

  function formatRelativeShort(ts) {
    const t = Number(ts);
    if (!t || Number.isNaN(t)) return '—';
    const diff = Date.now() - t;
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h} h`;
    const d = Math.floor(h / 24);
    return `há ${d} dia${d === 1 ? '' : 's'}`;
  }

  function formatFullDateTime(ts) {
    const t = Number(ts);
    if (!t || Number.isNaN(t)) return '—';
    try {
      return new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return '—';
    }
  }

  function setAdminSyncDetailIcon(el, ok) {
    if (!el) return;
    el.classList.toggle('admin-sync-detail__icon--ok', ok);
    el.classList.toggle('admin-sync-detail__icon--warn', !ok);
    el.innerHTML = ok
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>';
  }

  function updateTopbarSyncBadge(totalPending) {
    const badge = document.getElementById('topbar-notify-count');
    if (!badge) return;
    const n = Math.max(0, Number(totalPending) || 0);
    if (n > 0) {
      badge.textContent = String(Math.min(n, 99));
      badge.hidden = false;
      badge.setAttribute('aria-hidden', 'false');
    } else {
      badge.hidden = true;
      badge.setAttribute('aria-hidden', 'true');
    }
  }

  async function refreshAdminSyncPanel() {
    const syncMsg = document.getElementById('admin-sync-msg');
    if (syncMsg) {
      syncMsg.hidden = true;
      syncMsg.classList.remove('admin-sync-msg--ok', 'admin-sync-msg--err');
    }

    const localStatus = document.getElementById('admin-sync-local-status');
    const localMeta = document.getElementById('admin-sync-local-meta');
    const cloudMeta = document.getElementById('admin-sync-cloud-meta');
    const lastFullEl = document.getElementById('admin-sync-last-full');
    const pendingTotalEl = document.getElementById('admin-sync-pending-total');
    const pendingMetaEl = document.getElementById('admin-sync-pending-meta');
    const detailPac = document.getElementById('admin-sync-detail-pacientes');
    const detailEx = document.getElementById('admin-sync-detail-exames');
    const detailFotos = document.getElementById('admin-sync-detail-fotos');
    const detailLogs = document.getElementById('admin-sync-detail-logs');
    const iconEx = document.querySelector('[data-admin-sync-detail="exames"] .admin-sync-detail__icon');
    const iconFotos = document.getElementById('admin-sync-icon-fotos');

    if (!window.clubAccess?.localDbStats) {
      if (localStatus) localStatus.textContent = '—';
      if (localMeta) localMeta.textContent = 'Indisponível';
      updateTopbarSyncBadge(0);
      return;
    }

    let res;
    try {
      res = await window.clubAccess.localDbStats();
    } catch {
      res = { ok: false };
    }

    if (!res?.ok) {
      if (localStatus) localStatus.textContent = 'Erro';
      if (localMeta) localMeta.textContent = res?.error || 'Não foi possível ler o banco local.';
      updateTopbarSyncBadge(0);
      return;
    }

    const rows = Number(res.totalRows) || 0;
    const bytes = Number(res.dbBytes) || 0;
    if (localStatus) localStatus.textContent = 'OK';
    if (localMeta) localMeta.textContent = `${rows} registros · ${formatBytes(bytes)}`;

    const pendingPhotos = Number(res.pendingPhotos) || 0;
    const pendingExams = Number(res.pendingExams) || 0;
    const pending = pendingPhotos + pendingExams;

    if (pendingTotalEl) pendingTotalEl.textContent = String(pending);
    if (pendingMetaEl) {
      pendingMetaEl.textContent =
        pending === 0
          ? 'Nenhuma pendência'
          : `${pendingPhotos} foto${pendingPhotos === 1 ? '' : 's'} · ${pendingExams} exame${pendingExams === 1 ? '' : 's'}`;
    }

    updateTopbarSyncBadge(pending);

    const last = Number(localStorage.getItem(LS_ADMIN_LAST_FULL_SYNC) || 0);
    if (cloudMeta) {
      cloudMeta.textContent = last > 0 ? `Última sync: ${formatRelativeShort(last)}` : 'Última sync: —';
    }
    if (lastFullEl) {
      lastFullEl.textContent =
        last > 0
          ? `Última sincronização completa: ${formatFullDateTime(last)}`
          : 'Última sincronização completa: —';
    }

    if (detailPac) detailPac.textContent = 'Sincronizado';
    if (detailLogs) detailLogs.textContent = 'Sincronizado';

    if (detailEx) {
      detailEx.textContent =
        pendingExams > 0
          ? `${pendingExams} pendente${pendingExams === 1 ? '' : 's'}`
          : 'Sincronizado';
    }
    setAdminSyncDetailIcon(iconEx, pendingExams === 0);

    if (detailFotos) {
      detailFotos.textContent =
        pendingPhotos > 0
          ? `${pendingPhotos} pendente${pendingPhotos === 1 ? '' : 's'}`
          : 'Sincronizado';
    }
    setAdminSyncDetailIcon(iconFotos, pendingPhotos === 0);
  }

  function showPage(page) {
    activePage = page;
    if (acessosPollTimer) {
      clearInterval(acessosPollTimer);
      acessosPollTimer = null;
    }

    const isDashboard = page === 'dashboard';
    if (isDashboard) {
      clearNavActive();
      void refreshDashboard();
    } else {
      navBtns.forEach((btn) => {
        const active = btn.dataset.page === page;
        btn.classList.toggle('admin-nav-item--active', active);
        btn.setAttribute('aria-current', active ? 'page' : 'false');
      });
    }

    Object.entries(views).forEach(([key, el]) => {
      if (!el) return;
      const on = key === page;
      el.hidden = !on;
      el.classList.toggle('admin-view--active', on);
    });

    if (page === 'pacientes') {
      refreshPacientesList();
    }
    if (page === 'dispositivo') {
      void refreshDeviceUI();
    }
    if (page === 'configuracoes') {
      void (async () => {
        await hydrateDeviceSettingsFromMain();
        fillDeviceSettingsForm();
        await fillXpeBridgeFromServer();
        await refreshXpeWizard();
      })();
    }
    if (page === 'acessos') {
      void refreshAcessos();
      acessosPollTimer = setInterval(() => {
        void refreshAcessos();
      }, 10000);
    }
    if (page === 'relatorios') {
      setReportKpiCardsActive();
      void refreshReports();
    }
    if (page === 'sincronizacao') {
      void refreshAdminSyncPanel();
    }
    if (page === 'exames') {
      void loadExamsList();
    }
  }

  navBtns.forEach((btn) => {
    btn.addEventListener('click', () => showPage(btn.dataset.page));
  });

  function goDashboard(e) {
    if (e) {
      e.preventDefault();
    }
    showPage('dashboard');
  }

  brand?.addEventListener('click', goDashboard);
  brand?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      goDashboard();
    }
  });

  function getTopbarQuery() {
    return String(topbarSearch?.value || '').trim();
  }

  function getFilteredAcessos() {
    const raw = getTopbarQuery();
    const q = raw.toLowerCase();
    const qDigits = formatCpfDigits(raw);
    return acessosCache.filter((row) => {
      if (!q && !qDigits) return true;
      const name = String(row.full_name || '').toLowerCase();
      const cpf = formatCpfDigits(row.cpf);
      if (q && name.includes(q)) return true;
      if (qDigits.length >= 3 && cpf.includes(qDigits)) return true;
      return false;
    });
  }

  async function refreshAcessos() {
    let rows = [];
    let stats = { total: 0, granted: 0, denied: 0 };
    try {
      rows = (await window.clubAccess.accessList(100)) || [];
    } catch {
      rows = [];
    }
    try {
      stats = (await window.clubAccess.accessStatsToday()) || stats;
    } catch {
      /* keep zeros */
    }
    acessosCache = Array.isArray(rows) ? rows : [];
    if (acessosStatTotal) acessosStatTotal.textContent = String(stats.total ?? 0);
    if (acessosStatGranted) acessosStatGranted.textContent = String(stats.granted ?? 0);
    if (acessosStatDenied) acessosStatDenied.textContent = String(stats.denied ?? 0);
    await renderAcessosList();
  }

  async function renderAcessosList() {
    if (!acessosList || !acessosEmpty) return;
    const rows = getFilteredAcessos();
    acessosList.innerHTML = '';
    if (!rows.length) {
      acessosEmpty.hidden = false;
      acessosEmpty.textContent =
        acessosCache.length === 0
          ? 'Nenhum evento registrado ainda.'
          : 'Nenhum resultado para a busca.';
      return;
    }
    acessosEmpty.hidden = true;

    for (const row of rows) {
      const granted = Boolean(Number(row.granted));
      const photoUrl = row.photo_path
        ? await window.clubAccess.toFileUrl(String(row.photo_path))
        : '';
      const loc = String(row.location || 'Catraca principal · Piscina');
      const meta = `${fmtTimeHms(row.created_at)} · ${loc}`;
      const li = document.createElement('li');
      li.className = 'admin-access-item';
      li.innerHTML = `
        <div class="admin-access-item__main">
          <img class="admin-access-item__avatar" src="${photoUrl || '../public/icons_login/user.png'}" width="44" height="44" alt="" loading="lazy" />
          <div class="admin-access-item__text">
            <p class="admin-access-item__name">${escapeHtml(row.full_name || '—')}</p>
            <p class="admin-access-item__meta">${escapeHtml(meta)}</p>
          </div>
        </div>
        ${
          granted
            ? `<span class="admin-access-badge admin-access-badge--ok">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
            Acesso liberado
          </span>`
            : `<span class="admin-access-badge admin-access-badge--denied">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            Negado
          </span>`
        }
      `;
      acessosList.appendChild(li);
    }
  }

  topbarSearch?.addEventListener('input', () => {
    if (activePage === 'acessos') {
      void renderAcessosList();
    }
    if (activePage === 'exames') {
      renderExamsTable();
    }
  });

  document.getElementById('view-dispositivo')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-device-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-device-action');
    if (action) void handleDeviceAction(action);
  });

  document.getElementById('field-xpe-bridge-port')?.addEventListener('input', () => updateXpeBridgeUrlHint());
  document.getElementById('field-xpe-bridge-path')?.addEventListener('input', () => updateXpeBridgeUrlHint());
  document.getElementById('field-pc-lan-ip')?.addEventListener('input', () => {
    xpeWizardLanIp = getPcLanIpFromField();
    updateXpeBridgeUrlHint();
    updateXpeSetupChecklist({});
  });
  document.getElementById('field-xpe-device-url')?.addEventListener('change', () => {
    syncDeviceUrlAndIpFields('url');
    updateXpeSetupChecklist({});
    void refreshXpeWizard();
  });
  document.getElementById('field-device-ip')?.addEventListener('change', () => {
    syncDeviceUrlAndIpFields('ip');
    updateXpeSetupChecklist({});
  });
  document.getElementById('field-device-port')?.addEventListener('change', () => {
    syncDeviceUrlAndIpFields('ip');
    updateXpeSetupChecklist({});
  });
  document.getElementById('field-xpe-web-user')?.addEventListener('input', () => {
    syncOpenDoorCredsFromWebFields();
    updateXpeSetupChecklist({});
  });
  document.getElementById('field-xpe-web-password')?.addEventListener('input', () => {
    syncOpenDoorCredsFromWebFields();
  });

  document.getElementById('btn-xpe-setup-apply')?.addEventListener('click', () => {
    void runXpeSetupApply();
  });
  document.getElementById('btn-xpe-setup-refresh')?.addEventListener('click', () => {
    void refreshXpeWizard();
  });
  document.getElementById('btn-xpe-copy-action-url')?.addEventListener('click', async () => {
    const val = String(document.getElementById('field-xpe-action-url')?.value || '').trim();
    if (!val) {
      alert('Nenhuma URL gerada. Execute "Detectar e configurar" primeiro.');
      return;
    }
    try {
      await navigator.clipboard.writeText(val);
      setXpeWizardStatus('URL copiada para a área de transferência.', 'ok');
    } catch {
      const el = document.getElementById('field-xpe-action-url');
      if (el) {
        el.select();
        document.execCommand('copy');
        setXpeWizardStatus('URL selecionada — use Ctrl+C se a cópia automática falhar.', 'warn');
      }
    }
  });
  document.getElementById('field-xpe-action-url')?.addEventListener('input', (e) => {
    if (e.target?.value) e.target.dataset.userEdited = '1';
  });

  document.querySelectorAll('input[name="colorTheme"]').forEach((el) => {
    el.addEventListener('change', () => {
      const theme = el.value === 'light' ? 'light' : 'dark';
      window.ClubAccessTheme?.applyColorTheme?.(theme);
    });
  });

  document.getElementById('btn-xpe-open-inbound-log')?.addEventListener('click', async () => {
    try {
      const r = await window.clubAccess.xpeBridgeOpenInboundLog();
      if (!r?.ok) {
        alert(r?.error || 'Não foi possível abrir o arquivo de log.');
      }
    } catch (e) {
      alert(String(e?.message || e));
    }
  });

  document.getElementById('form-device-settings')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('device-settings-msg');
    const prev = loadDeviceSettings();

    const urlRaw = String(document.getElementById('field-xpe-device-url')?.value || '').trim();
    if (urlRaw) {
      syncDeviceUrlAndIpFields('url');
    } else {
      syncDeviceUrlAndIpFields('ip');
    }
    syncOpenDoorCredsFromWebFields();

    const clubName =
      String(document.getElementById('field-club-name')?.value || '').trim() ||
      prev.clubName ||
      DEFAULT_DEVICE_SETTINGS.clubName;
    const systemName =
      String(document.getElementById('field-system-name')?.value || '').trim() ||
      prev.systemName ||
      DEFAULT_DEVICE_SETTINGS.systemName;
    const deviceName =
      String(document.getElementById('field-device-name')?.value || '').trim() ||
      prev.deviceName ||
      DEFAULT_DEVICE_SETTINGS.deviceName;
    const locationLabel =
      String(document.getElementById('field-location-label')?.value || '').trim() ||
      prev.locationLabel ||
      DEFAULT_DEVICE_SETTINGS.locationLabel;

    const ipRaw = String(document.getElementById('field-device-ip')?.value || '').trim();
    const ipNorm = normalizeDeviceIpv4(ipRaw);
    const devicePort = String(document.getElementById('field-device-port')?.value || '').trim() || '80';
    const lanIp = getPcLanIpFromField();

    const daysRaw = String(document.getElementById('field-exam-validity-days')?.value || '').trim();
    let days = Number.parseInt(daysRaw, 10);
    if (!Number.isFinite(days) || days < 1) {
      days = Number(prev.defaultExamValidityDays) || DEFAULT_DEVICE_SETTINGS.defaultExamValidityDays;
    }
    const weekdayChecks = Array.from(document.querySelectorAll('input[name="examAllowedWeekdays"]:checked'));
    let examAllowedWeekdays = normalizeExamAllowedWeekdays(weekdayChecks.map((el) => Number(el.value)));
    if (examAllowedWeekdays.length < 1) {
      examAllowedWeekdays = Array.isArray(prev.examAllowedWeekdays)
        ? prev.examAllowedWeekdays
        : DEFAULT_DEVICE_SETTINGS.examAllowedWeekdays;
    }

    if (!ipNorm) {
      if (msgEl) {
        msgEl.textContent =
          'Informe o IP do XPE (IPv4 com pontos, ex.: 192.168.0.67) ou a URL do painel.';
        msgEl.hidden = false;
        msgEl.style.color = '#fca5a5';
      }
      return;
    }
    if (normalizeDevicePort(devicePort) == null) {
      if (msgEl) {
        msgEl.textContent = 'Porta inválida. Use um número entre 1 e 65535 (ex.: 80).';
        msgEl.hidden = false;
        msgEl.style.color = '#fca5a5';
      }
      return;
    }
    if (!lanIp) {
      if (msgEl) {
        msgEl.textContent =
          'Informe o IP deste computador na LAN (para o XPE enviar o Log de Acesso). Use Detectar se precisar.';
        msgEl.hidden = false;
        msgEl.style.color = '#fca5a5';
      }
      return;
    }

    const clubNameEl = document.getElementById('field-club-name');
    const systemNameEl = document.getElementById('field-system-name');
    const examDaysEl = document.getElementById('field-exam-validity-days');
    if (clubNameEl) clubNameEl.value = clubName;
    if (systemNameEl) systemNameEl.value = systemName;
    if (examDaysEl) examDaysEl.value = String(days);

    const autoSync5Min = Boolean(document.getElementById('toggle-auto-sync')?.checked);
    const blockExpiredExams = Boolean(document.getElementById('toggle-block-expired')?.checked);
    const notify5DaysBefore = Boolean(document.getElementById('toggle-notify-5days')?.checked);
    const notifyDeniedAccess = Boolean(document.getElementById('toggle-notify-denied')?.checked);
    const dailyEmailSummary = Boolean(document.getElementById('toggle-daily-email')?.checked);
    const colorThemeInput = document.querySelector('input[name="colorTheme"]:checked');
    const colorTheme = colorThemeInput?.value === 'light' ? 'light' : 'dark';

    let openDoorBase = String(document.getElementById('field-xpe-open-door-base')?.value || '').trim();
    if (!openDoorBase) {
      openDoorBase = buildDeviceUrlFromIpPort(ipNorm, devicePort);
      const baseEl = document.getElementById('field-xpe-open-door-base');
      if (baseEl) baseEl.value = openDoorBase;
    }

    const webUser = String(document.getElementById('field-xpe-web-user')?.value || '').trim();
    const webPassword = String(document.getElementById('field-xpe-web-password')?.value || '');

    saveDeviceSettings({
      ...prev,
      clubName,
      systemName,
      deviceName,
      locationLabel,
      ip: ipNorm,
      devicePort: String(normalizeDevicePort(devicePort)),
      defaultExamValidityDays: days,
      examAllowedWeekdays,
      clubDisplayName: systemName,
      autoSync5Min,
      blockExpiredExams,
      notify5DaysBefore,
      notifyDeniedAccess,
      dailyEmailSummary,
      colorTheme,
    });
    applyBrandingFromSettings();

    const bridgePayload = {
      enabled: Boolean(document.getElementById('toggle-xpe-bridge-enabled')?.checked),
      port: Number.parseInt(String(document.getElementById('field-xpe-bridge-port')?.value || '37891'), 10),
      path: String(document.getElementById('field-xpe-bridge-path')?.value || '/intelbras/xpe').trim(),
      preferredLanIp: lanIp || '',
      sharedSecret: String(document.getElementById('field-xpe-bridge-secret')?.value || ''),
      openDoorWhenGranted: Boolean(document.getElementById('toggle-xpe-open-door')?.checked),
      openDoorBaseUrl: openDoorBase,
      openDoorUser: webUser,
      openDoorPassword: webPassword,
      openDoorNum: String(document.getElementById('field-xpe-open-door-num')?.value || '1').trim() || '1',
      logInboundRequests: Boolean(document.getElementById('toggle-xpe-bridge-log-inbound')?.checked),
    };
    let bridgeMsg = '';
    try {
      const br = await window.clubAccess.xpeBridgeSetSettings(bridgePayload);
      if (!br?.ok) {
        bridgeMsg = ` Bridge HTTP: ${br?.bridgeStartError || 'falha ao aplicar.'}`;
      }
    } catch (err) {
      bridgeMsg = ` Bridge HTTP: ${String(err?.message || err)}`;
    }
    await fillXpeBridgeFromServer();
    updateXpeSetupChecklist({});

    if (msgEl) {
      msgEl.textContent = bridgeMsg ? `Salvo.${bridgeMsg}` : 'Alterações salvas.';
      msgEl.style.color = bridgeMsg ? '#fca5a5' : '';
      msgEl.hidden = false;
    }
    if (activePage === 'dispositivo') {
      void refreshDeviceUI();
    }
    if (activePage === 'dashboard') {
      void refreshDashboard();
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', () => {
    try {
      sessionStorage.removeItem('clubAccessRole');
      sessionStorage.removeItem('clubAccessUser');
      sessionStorage.removeItem('clubAccessDisplayName');
    } catch {
      /* ignore */
    }
    window.location.href = '../login/login.html';
  });

  document.getElementById('btn-admin-sync-all')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-admin-sync-all');
    const syncMsg = document.getElementById('admin-sync-msg');
    if (btn) btn.disabled = true;
    try {
      localStorage.setItem(LS_ADMIN_LAST_FULL_SYNC, String(Date.now()));
      await refreshAdminSyncPanel();
      if (syncMsg) {
        syncMsg.textContent = 'Sincronização registrada neste dispositivo.';
        syncMsg.classList.remove('admin-sync-msg--err');
        syncMsg.classList.add('admin-sync-msg--ok');
        syncMsg.hidden = false;
      }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  document.getElementById('btn-topbar-notify')?.addEventListener('click', () => {
    showPage('sincronizacao');
  });

  applyBrandingFromSettings();
  void hydrateDeviceSettingsFromMain().then(() => applyBrandingFromSettings());
  void refreshAdminSyncPanel();
  showPage('dashboard');
})();
