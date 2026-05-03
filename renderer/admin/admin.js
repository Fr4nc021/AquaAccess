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
    deviceName: 'Intelbras FR-3000',
    locationLabel: 'Catraca principal',
    ip: '192.168.1.45',
    firmware: '3.2.1',
    clubDisplayName: 'AquaAccess',
    clubName: 'Clube Atlético Marítimo',
    systemName: 'AquaAccess',
    defaultExamValidityDays: 30,
    devicePort: '8080',
    autoSync5Min: true,
    blockExpiredExams: true,
    notify5DaysBefore: true,
    notifyDeniedAccess: true,
    dailyEmailSummary: false,
  };

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

  function loadDeviceSettings() {
    try {
      const raw = localStorage.getItem(DEVICE_SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_DEVICE_SETTINGS };
      const o = JSON.parse(raw);
      const merged = { ...DEFAULT_DEVICE_SETTINGS, ...o };
      if (!merged.systemName && merged.clubDisplayName) {
        merged.systemName = merged.clubDisplayName;
      }
      return merged;
    } catch {
      return { ...DEFAULT_DEVICE_SETTINGS };
    }
  }

  function saveDeviceSettings(s) {
    localStorage.setItem(DEVICE_SETTINGS_KEY, JSON.stringify(s));
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
  }

  function fillDeviceSettingsForm() {
    const s = loadDeviceSettings();
    const clubName = document.getElementById('field-club-name');
    const systemName = document.getElementById('field-system-name');
    const validityDays = document.getElementById('field-exam-validity-days');
    const ip = document.getElementById('field-device-ip');
    const port = document.getElementById('field-device-port');
    const sync = document.getElementById('toggle-auto-sync');
    const blockExp = document.getElementById('toggle-block-expired');
    const n5 = document.getElementById('toggle-notify-5days');
    const denied = document.getElementById('toggle-notify-denied');
    const daily = document.getElementById('toggle-daily-email');
    if (clubName) clubName.value = s.clubName ?? '';
    if (systemName) systemName.value = s.systemName ?? '';
    if (validityDays) validityDays.value = String(s.defaultExamValidityDays ?? DEFAULT_DEVICE_SETTINGS.defaultExamValidityDays);
    if (ip) ip.value = s.ip || '';
    if (port) port.value = s.devicePort ?? '';
    if (sync) sync.checked = Boolean(s.autoSync5Min ?? DEFAULT_DEVICE_SETTINGS.autoSync5Min);
    if (blockExp) blockExp.checked = Boolean(s.blockExpiredExams ?? DEFAULT_DEVICE_SETTINGS.blockExpiredExams);
    if (n5) n5.checked = Boolean(s.notify5DaysBefore ?? DEFAULT_DEVICE_SETTINGS.notify5DaysBefore);
    if (denied) denied.checked = Boolean(s.notifyDeniedAccess ?? DEFAULT_DEVICE_SETTINGS.notifyDeniedAccess);
    if (daily) daily.checked = Boolean(s.dailyEmailSummary ?? DEFAULT_DEVICE_SETTINGS.dailyEmailSummary);
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
          ? `Enviar ${patientTotal} cadastro${patientTotal === 1 ? '' : 's'}`
          : 'Nenhum cadastro para enviar';
    }
    if (subPhotos) {
      subPhotos.textContent =
        pendingVal > 0
          ? `${pendingVal} foto${pendingVal === 1 ? '' : 's'} aguardando`
          : 'Nenhuma foto na fila';
    }

    renderDeviceLogs();
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
        runtime.connected = true;
        saveDeviceRuntime(runtime);
        pushDeviceLog({
          type: 'ok',
          title: 'Conexão estabelecida',
          actor: settings.deviceName || 'Leitor',
        });
      }
      await refreshDeviceUI();
      return;
    }

    if (action === 'sync') {
      if (!runtime.connected) {
        alert('Conecte o dispositivo antes de sincronizar.');
        return;
      }
      let rows = [];
      try {
        rows = (await window.clubAccess.patientsListOverview()) || [];
      } catch {
        rows = [];
      }
      const list = Array.isArray(rows) ? rows : [];
      const n = list.length;
      const withPhoto = list.filter((r) => r.photo_path && String(r.photo_path).trim()).length;
      runtime.lastSyncAt = new Date().toISOString();
      runtime.lastSyncedCount = n;
      runtime.pendingPhotos = withPhoto;
      saveDeviceRuntime(runtime);
      pushDeviceLog({
        type: 'info',
        title: `Sincronização concluída — ${n} usuário${n === 1 ? '' : 's'}`,
        actor: 'Sistema',
      });
      await refreshDeviceUI();
      return;
    }

    if (action === 'photos') {
      if (!runtime.connected) {
        alert('Conecte o dispositivo antes de enviar fotos.');
        return;
      }
      const pending = Math.max(0, runtime.pendingPhotos);
      if (pending <= 0) {
        alert('Não há fotos pendentes na fila. Use “Sincronizar usuários” para atualizar a fila a partir dos cadastros.');
        return;
      }
      runtime.pendingPhotos = 0;
      saveDeviceRuntime(runtime);
      pushDeviceLog({
        type: 'info',
        title: `Envio concluído — ${pending} foto${pending === 1 ? '' : 's'}`,
        actor: 'Sistema',
      });
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
      fillDeviceSettingsForm();
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

  document.getElementById('form-device-settings')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const msgEl = document.getElementById('device-settings-msg');
    const prev = loadDeviceSettings();
    const clubName = String(document.getElementById('field-club-name')?.value || '').trim();
    const systemName = String(document.getElementById('field-system-name')?.value || '').trim();
    const ip = String(document.getElementById('field-device-ip')?.value || '').trim();
    const devicePort = String(document.getElementById('field-device-port')?.value || '').trim();
    const daysRaw = String(document.getElementById('field-exam-validity-days')?.value || '').trim();
    const days = Number.parseInt(daysRaw, 10);
    if (!clubName || !systemName || !ip || !devicePort || !Number.isFinite(days) || days < 1) {
      if (msgEl) {
        msgEl.textContent = 'Preencha nome do clube, nome do sistema, IP, porta e validade do exame (dias ≥ 1).';
        msgEl.hidden = false;
        msgEl.style.color = '#fca5a5';
      }
      return;
    }
    const autoSync5Min = Boolean(document.getElementById('toggle-auto-sync')?.checked);
    const blockExpiredExams = Boolean(document.getElementById('toggle-block-expired')?.checked);
    const notify5DaysBefore = Boolean(document.getElementById('toggle-notify-5days')?.checked);
    const notifyDeniedAccess = Boolean(document.getElementById('toggle-notify-denied')?.checked);
    const dailyEmailSummary = Boolean(document.getElementById('toggle-daily-email')?.checked);

    saveDeviceSettings({
      ...prev,
      clubName,
      systemName,
      ip,
      devicePort,
      defaultExamValidityDays: days,
      clubDisplayName: systemName,
      autoSync5Min,
      blockExpiredExams,
      notify5DaysBefore,
      notifyDeniedAccess,
      dailyEmailSummary,
    });
    applyBrandingFromSettings();
    if (msgEl) {
      msgEl.textContent = 'Alterações salvas.';
      msgEl.style.color = '';
      msgEl.hidden = false;
    }
    if (activePage === 'dispositivo') {
      void refreshDeviceUI();
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
  void refreshAdminSyncPanel();
  showPage('dashboard');
})();
