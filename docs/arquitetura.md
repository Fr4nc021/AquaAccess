# AquaAccess Facial — Documentação de Arquitetura

**Versão do app:** 1.1.0  
**Produto:** AquaAccess Facial  
**Público:** novos desenvolvedores e onboarding técnico  
**Última atualização:** julho de 2026

---

## 1. Visão geral

O **AquaAccess Facial** é uma aplicação desktop **offline-first** para **controle de acesso às piscinas** de um clube. O fluxo principal cobre:

1. Cadastro de associados (chamados de *pacientes* na UI e no banco)
2. Registro e validade de exames médicos
3. Liberação ou negação de acesso à catraca/piscina
4. Integração em rede com o videoporteiro **Intelbras XPE 3200 PLUS IP**

Não há backend remoto obrigatório no momento: tudo roda localmente no PC do clube. A tela de sincronização com nuvem (Supabase) existe na UI, mas ainda é **placeholder**.

---

## 2. Stack tecnológica

| Camada | Tecnologia |
|--------|------------|
| Runtime desktop | Electron 41 |
| Interface | HTML, CSS e JavaScript vanilla (sem React/Vue) |
| Banco local | sql.js (SQLite em WASM, persistido em arquivo) |
| Autenticação | bcryptjs (hash de senha) |
| Integração XPE | Servidor HTTP local + probe TCP + Playwright (opcional) |
| Empacotamento | electron-builder (instalador NSIS para Windows) |

### Scripts npm úteis

| Comando | Função |
|---------|--------|
| `npm start` | Abre o app em desenvolvimento |
| `npm run dist` | Gera o instalador em `release/` |
| `npm run xpe:install-browser` | Instala Chromium do Playwright |
| `npm run xpe:test` | Teste isolado da automação XPE |

---

## 3. Estrutura de pastas

```
facial/
├── main.js                 # Processo principal Electron (janela, IPC, fotos, bridge)
├── preload.js              # contextBridge → window.clubAccess
├── db.js                   # Schema SQLite + regras de negócio
├── xpeBridge.js            # Servidor HTTP para eventos do XPE
├── xpeSetup.js             # Descoberta de IP/LAN e assistente de setup
├── xpeAutomation/          # Playwright: login e sync no painel web do XPE
│   ├── config.js
│   ├── login.js
│   ├── selectors.js
│   ├── syncUser.js
│   └── test.js
├── renderer/
│   ├── login/              # Tela de login
│   ├── medico/             # Painel do médico (pacientes + exames)
│   ├── admin/              # Shell admin + views + admin.js
│   │   ├── home.html
│   │   ├── admin.js
│   │   ├── admin-views-loader.js
│   │   └── views/          # Fragmentos HTML das telas
│   ├── shared/             # CSS compartilhado
│   └── public/             # Ícones e assets
├── docs/                   # Documentação (este arquivo)
├── package.json
└── release/                # Artefatos de build (não é código-fonte)
```

### Dados em runtime (Windows)

Pasta típica: `%APPDATA%\AquaAccess Facial\`

| Item | Conteúdo |
|------|----------|
| `club-piscinas.db` | Banco SQLite |
| `patient-photos/` | Fotos dos associados |
| `device-settings.json` | Configurações gerais do clube/exame/dispositivo |
| `xpe-bridge-settings.json` | Bridge HTTP e OpenDoor |
| `xpe-integration.json` | Estado da integração / probe do XPE |
| `xpe-export/` | Pastas geradas ao sincronizar usuários |
| `xpe-bridge-inbound.ndjson` | Log bruto das requisições do XPE |
| `xpe-automation-errors/` | Screenshots de falha do Playwright |

---

## 4. Arquitetura de processos (Electron)

```
┌──────────────────────────────────────────────────────────────┐
│  Processo Principal (main.js)                                │
│  ├─ db.js           → pacientes, exames, acessos, users      │
│  ├─ xpeBridge.js    → HTTP in ← XPE                          │
│  ├─ xpeSetup.js     → descoberta / assistente                │
│  └─ xpeAutomation/  → Playwright → painel web XPE            │
├──────────────────────────────────────────────────────────────┤
│  preload.js → window.clubAccess.*  (API segura)              │
├──────────────────────────────────────────────────────────────┤
│  Renderer                                                    │
│  login → medico | admin (HTML + JS monólito)                 │
└──────────────────────────────────────────────────────────────┘
```

Regras de segurança do Electron neste projeto:

- `contextIsolation: true`
- `nodeIntegration: false`
- Comunicação só via IPC (`ipcMain.handle` / `ipcRenderer.invoke`)

**Padrão para qualquer feature nova:**  
`db.js` → `main.js` (IPC) → `preload.js` → renderer.

---

## 5. Fluxo desde a abertura do sistema

1. Usuário executa `npm start` ou o instalador Windows.
2. `app.whenReady` em `main.js`:
   - `initDb()` — carrega ou cria `club-piscinas.db`
   - auto-discover do XPE (se já houver IP configurado)
   - reinicia o bridge HTTP, se habilitado
3. `createWindow()` abre `renderer/login/login.html` (menu nativo desabilitado).
4. Login chama `window.clubAccess.login(username, password)`.
5. Main valida com `authenticateUser` em `db.js` (bcrypt + usuário ativo).
6. Sessão fica em `sessionStorage`:
   - `clubAccessRole` (`admin` ou `medico`)
   - `clubAccessUser`
   - `clubAccessDisplayName`
7. Redirecionamento:
   - **admin** → `renderer/admin/home.html`
   - **médico** → `renderer/medico/medico.html`
8. Cada painel valida o role no `sessionStorage`; se inválido, volta ao login.

### Credenciais padrão (seed do banco)

| Perfil | Usuário | Senha |
|--------|---------|-------|
| Administrador | `admin` | `admin` |
| Médico | `medico` | `admin` |

Altere as senhas em produção.

### Diagrama do fluxo

```
npm start / instalador
        │
        ▼
 app.whenReady → initDb → XPE discover → bridge HTTP
        │
        ▼
   login.html
        │
   login OK?
   ├── role admin  → admin/home.html
   └── role medico → medico/medico.html

(paralelo) XPE → HTTP bridge → registerPoolAccess → access_events
                         └── se granted + OpenDoor → HTTP OpenDoor no equipamento
```

---

## 6. Autenticação e perfis

### Como funciona

1. UI envia usuário/senha via IPC `login`.
2. `authenticateUser` busca em `users`, compara hash bcrypt e checa `active`.
3. Role normalizado: apenas **`admin`** ou **`medico`**.
4. A aba escolhida no login deve bater com o role (exceção: admin pode entrar na aba médico).
5. Não há JWT nem sessão de servidor — só `sessionStorage` no renderer.

### Observação de segurança

Hoje **não há checagem de role no lado do IPC**. Qualquer renderer autenticado pode chamar as APIs do preload. Em hardening futuro, validar permissões no `main.js`.

### Usuários do sistema (staff)

Funções já existem em `db.js`:

- `listSystemUsers`
- `createSystemUser`
- `updateSystemUser`
- `setSystemUserActive`

Porém **ainda não estão expostas** no `preload.js` / `main.js` nem há tela de CRUD. O seed cria `admin` e `medico` no primeiro boot.

---

## 7. Banco de dados

Engine: **sql.js**. Cada escrita chama `persist()`, que exporta o banco inteiro para disco.

### Tabelas

#### `users` — operadores do software

| Coluna | Descrição |
|--------|-----------|
| id | PK |
| username | único |
| password_hash | bcrypt |
| display_name, email | opcionais |
| role | `admin` ou `medico` |
| active | 1/0 |
| created_at | timestamp |

#### `patients` — associados do clube

| Coluna | Descrição |
|--------|-----------|
| id | PK (também usado como ID Usuário no XPE) |
| full_name | nome |
| cpf | único (11 dígitos ou marcador interno se sem CPF) |
| phone | DDD + número |
| photo_path | caminho relativo da foto |
| blocked | bloqueio manual |
| created_at | timestamp |

#### `exams` — exames médicos

| Coluna | Descrição |
|--------|-----------|
| id | PK |
| patient_id | FK → patients |
| exam_date | data do exame |
| valid_until | fim da validade |
| status | `Válido`, `Substituído`, etc. |
| notes | opcional |
| created_at | timestamp |

#### `access_events` — histórico de acessos

| Coluna | Descrição |
|--------|-----------|
| id | PK |
| patient_id | FK → patients |
| granted | 1 liberado / 0 negado |
| location | local (ex.: catraca) |
| created_at | ISO timestamp |

Migrações são ad-hoc (`ALTER TABLE` em try/catch na inicialização).

---

## 8. Cadastro de associados (pacientes)

Fluxo principal no **painel médico** (`renderer/medico/medico.js`):

1. Preenche nome, telefone (obrigatório) e CPF (opcional).
2. Anexa **foto obrigatória** (arquivo ou câmera).
3. Chama `patientsCreate` → IPC → `createPatient` em `db.js`.
4. Main grava a foto em `patient-photos/<id>.ext` e atualiza `photo_path`.

Validações relevantes em `createPatient`:

- Nome obrigatório
- Telefone completo (10–11 dígitos)
- CPF com 11 dígitos se informado; senão gera marcador único
- CPF não pode duplicar

O **admin** gerencia lista, edição, bloqueio, exclusão e sincronização com o XPE.

> No domínio do produto, “funcionários” do clube (associados) = `patients`.  
> Operadores do app = `users`.

---

## 9. Regras de negócio (onde ficam)

**Centro de verdade: `db.js`.**

### Liberação de acesso — `registerPoolAccess`

Concede acesso se **todas** forem verdadeiras:

1. Paciente existe
2. Paciente **não** está `blocked`
3. Existe exame com `status = 'Válido'` cuja `valid_until` é **hoje ou futura**  
   (inclui o caso “vence nesta semana”)

Caso contrário, nega. **Sempre** grava um registro em `access_events`.

Estados de atenção usados internamente:

| Atenção | Significado |
|---------|-------------|
| `valido` | exame vigente além desta semana |
| `vence_semana` | vence até o domingo desta semana |
| `vencido` | validade no passado |
| `sem_exame` | sem exame válido |

### Registro de exame — `createExam`

1. Data do exame (ou hoje)
2. Validade = data + N dias (configurável; padrão 30)
3. Alinha `valid_until` aos dias da semana permitidos (ex.: só dias úteis)
4. Exames ainda vigentes do mesmo paciente passam a `Substituído`
5. Novo registro fica com status `Válido`

### Configurações que afetam as regras

Arquivo `device-settings.json` (e espelho em `localStorage` no admin), por exemplo:

- `defaultExamValidityDays`
- `examAllowedWeekdays`
- `blockExpiredExams`
- nome do clube / sistema
- IP e porta do XPE

---

## 10. Integração Intelbras XPE

### Bridge HTTP (`xpeBridge.js`)

O XPE envia eventos de acesso (Ações URL → Log de Acesso) para o PC:

- Exemplo: `http://<IP-do-PC>:37891/intelbras/xpe?userId=123`
- Também aceita identificação por CPF (11 dígitos)

Fluxo:

1. Bridge recebe GET/POST
2. Extrai `userId` / CPF / outros aliases
3. `findPatientIdForXpeBridge` resolve o paciente
4. Chama a **mesma** `registerPoolAccess` do app
5. Se liberado e OpenDoor estiver ativo → HTTP `OpenDoor` no equipamento

Token opcional: header `X-AquaAccess-Token`.

### Exportação / sync de fotos

- **Sincronizar usuários** (admin): gera pasta com fotos, CSV e `LEIA-ME.txt`
- No XPE, o **ID Usuário** deve ser igual ao `patients.id` do AquaAccess
- **Sincronizar Intelbras** (Playwright): automatiza o painel web (sem API oficial)

### Assistente de setup (`xpeSetup.js`)

Detecta IP LAN do PC, faz probe no equipamento e monta a URL pronta para colar no XPE.

---

## 11. Módulos da interface

### Login

Abas Médico / Administrador, validação de perfil e redirecionamento.

### Painel médico

| Tela | Função |
|------|--------|
| Pacientes | Cadastro, foto, busca, visão geral por atenção |
| Exames | Validar exame e histórico |

### Painel admin

Shell em `home.html`. O loader injeta HTML de `views/` via `readRendererFile` e depois carrega `admin.js`.

| View | Função |
|------|--------|
| Visão geral | Dashboard (contagens, gráfico, status do leitor) |
| Pacientes | Lista, filtros, edição, bloqueio, sync XPE |
| Controle de acessos | Eventos e estatísticas do dia |
| Dispositivo facial | TCP, export, bridge, sync Playwright |
| Relatórios | PDF (impressão) e Excel/CSV |
| Sincronização | Status local; nuvem ainda placeholder |
| Exames | Gestão administrativa de exames |
| Configurações | Clube, regras, XPE, bridge, notificações |

---

## 12. Como adicionar um novo módulo

Checklist alinhado à arquitetura atual:

1. **Dados / regras** — implementar e exportar funções em `db.js`.
2. **IPC** — registrar `ipcMain.handle('meu-canal', ...)` em `main.js`.
3. **Preload** — expor em `window.clubAccess` em `preload.js`.
4. **UI Admin** (se for tela admin):
   - criar `renderer/admin/views/meu-modulo.html`
   - incluir o path em `VIEW_FILES` em `admin-views-loader.js`
   - adicionar item de navegação em `home.html`
   - implementar lógica em `admin.js`
5. **UI Médico** (se for tela médico): seções em `medico.html` + handlers em `medico.js`.
6. **Integração externa** (se houver): módulo irmão de `xpeBridge.js` / `xpeSetup.js`, chamado só pelo main.

Não acessar Node, filesystem ou banco direto no renderer.

---

## 13. Limitações e pendências conhecidas

| Item | Situação |
|------|----------|
| Sync nuvem / Supabase | UI placeholder |
| CRUD de usuários do sistema | Funções no `db.js`, sem IPC/UI |
| Autorização por role no IPC | Ainda não implementada |
| Browsers do Playwright no instalador | Não embutidos; instalar no PC destino |
| `admin.js` | Monólito grande (~2.5k linhas) — atenção ao crescer |

---

## 14. Pontos de partida recomendados no código

1. `db.js` — `createPatient`, `createExam`, `registerPoolAccess`, `authenticateUser`
2. `preload.js` — inventário da API pública
3. `main.js` — bootstrap, IPC e bridge
4. `renderer/login/login.js` — roteamento por perfil
5. `xpeBridge.js` — caminho hardware → regra de acesso

---

## 15. Referência rápida de API (preload)

Principais métodos de `window.clubAccess`:

| Método | Uso |
|--------|-----|
| `login` | Autenticação |
| `patientsCreate` / `Update` / `List` / `Delete` / … | Pacientes |
| `examsRegister` / `examsList` / `examsDelete` | Exames |
| `accessRegisterPool` / `accessList` / `accessStatsToday` | Acessos |
| `reportsSummary` / `reportsRows` | Relatórios |
| `dashboardSnapshot` / `localDbStats` | Dashboard |
| `deviceConnectivityCheck` | Ping TCP no XPE |
| `deviceSettingsGet` / `Set` | Configurações |
| `xpeBridgeGetSettings` / `Set` / `GetStatus` | Bridge |
| `xpeExportUserPack` | Export de fotos/manifesto |
| `xpeSyncUser` | Sync Playwright |
| `xpeSetupDiscover` / `Apply` | Assistente Intelbras |

---

*Documento gerado para onboarding técnico do projeto AquaAccess Facial.*
