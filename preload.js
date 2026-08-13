const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('clubAccess', {
  readRendererFile: (relativePath) => ipcRenderer.invoke('read-renderer-file', relativePath),
  login: (username, password) => ipcRenderer.invoke('login', { username, password }),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  toFileUrl: (relativePath) => ipcRenderer.invoke('to-file-url', relativePath),
  patientsCreate: (payload) => ipcRenderer.invoke('patients-create', payload),
  patientsUpdate: (payload) => ipcRenderer.invoke('patients-update', payload),
  patientsSearch: (query, limit) =>
    ipcRenderer.invoke('patients-search', { query, limit }),
  patientsGet: (id) => ipcRenderer.invoke('patients-get', id),
  patientsLookupCpf: (cpf) => ipcRenderer.invoke('patients-cpf-lookup', { cpf }),
  patientsDelete: (id) => ipcRenderer.invoke('patients-delete', { id }),
  patientsList: () => ipcRenderer.invoke('patients-list'),
  patientsListOverview: () => ipcRenderer.invoke('patients-list-overview'),
  patientsSetBlocked: (id, blocked) =>
    ipcRenderer.invoke('patients-set-blocked', { id, blocked }),
  examsList: () => ipcRenderer.invoke('exams-list'),
  examsRegister: (payload) => ipcRenderer.invoke('exams-register', payload),
  examsDelete: (id) => ipcRenderer.invoke('exams-delete', { id }),
  accessRegisterPool: (payload) => ipcRenderer.invoke('access-register-pool', payload),
  accessList: (limit) => ipcRenderer.invoke('access-list', { limit }),
  accessStatsToday: () => ipcRenderer.invoke('access-stats-today'),
  reportsSummary: (periodStart, periodEnd) =>
    ipcRenderer.invoke('reports-summary', { periodStart, periodEnd }),
  reportsRows: (kind, periodStart, periodEnd) =>
    ipcRenderer.invoke('reports-rows', { kind, periodStart, periodEnd }),
  localDbStats: () => ipcRenderer.invoke('local-db-stats'),
  deviceConnectivityCheck: (ip, port, timeoutMs) =>
    ipcRenderer.invoke('device-connectivity-check', { ip, port, timeoutMs }),
  dashboardSnapshot: () => ipcRenderer.invoke('dashboard-snapshot'),
  xpeBridgeGetSettings: () => ipcRenderer.invoke('xpe-bridge-get-settings'),
  xpeBridgeSetSettings: (payload) => ipcRenderer.invoke('xpe-bridge-set-settings', payload),
  xpeBridgeGetStatus: () => ipcRenderer.invoke('xpe-bridge-get-status'),
  xpeExportUserPack: () => ipcRenderer.invoke('xpe-export-user-pack'),
  xpeExportOpenLastFolder: () => ipcRenderer.invoke('xpe-export-open-last-folder'),
  xpeBridgeInboundLogPath: () => ipcRenderer.invoke('xpe-bridge-inbound-log-path'),
  xpeBridgeOpenInboundLog: () => ipcRenderer.invoke('xpe-bridge-open-inbound-log'),
  xpeSyncUser: (payload) => ipcRenderer.invoke('xpe-sync-user', payload),
  deviceSettingsGet: () => ipcRenderer.invoke('device-settings-get'),
  deviceSettingsSet: (payload) => ipcRenderer.invoke('device-settings-set', payload),
  xpeSetupDiscover: (payload) => ipcRenderer.invoke('xpe-setup-discover', payload || {}),
  xpeSetupApply: (payload) => ipcRenderer.invoke('xpe-setup-apply', payload),
});
