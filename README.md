# AquaAccess (facial)

Aplicação desktop **offline-first** para **controle de acesso às piscinas do clube**, com cadastro de associados, validação de exames médicos e integração em rede com o **videoporteiro Intelbras XPE 3200 PLUS IP** (HTTP: bridge de eventos + exportação de fotos/manifesto).

## Stack

- **Electron** (janela principal e IPC)
- **sql.js** — banco SQLite local
- **bcryptjs** — autenticação de usuários

---

## Como baixar e executar o app

### Opção A — Desenvolvimento (código-fonte)

1. Instale [Node.js](https://nodejs.org/) (LTS recomendado).
2. No terminal, na pasta do projeto:

```bash
npm install
npm start
```

3. A janela abre no login. Credenciais padrão do banco local:
   - **Administrador:** usuário `admin`, senha `admin`
   - **Médico:** usuário `medico`, senha `admin`  
   Altere as senhas após o primeiro uso em produção.

### Opção B — Instalador Windows (produção)

1. Gere o instalador na pasta `release/`:

```bash
npm install
npm run dist
```

2. Execute o arquivo gerado (ex.: `release/AquaAccess Facial Setup 1.0.0.exe`) e siga o assistente.
3. Abra o **AquaAccess Facial** pelo atalho do menu Iniciar ou da área de trabalho.

### Onde ficam os dados (importante para backup)

No Windows, o Electron guarda dados de usuário em uma pasta do tipo:

`%APPDATA%\AquaAccess Facial\`  
(ou nome semelhante conforme `productName` no `package.json`)

Lá ficam, entre outros:

| Arquivo / pasta | Conteúdo |
|-----------------|----------|
| `club-piscinas.db` | Banco SQLite (pacientes, exames, acessos) |
| `patient-photos/` | Fotos dos pacientes |
| `xpe-bridge-settings.json` | Configuração do bridge HTTP |
| `xpe-bridge-inbound.ndjson` | **Log bruto** das requisições enviadas pelo XPE (uma linha JSON por evento) |
| `xpe-export/` | Pastas geradas por **Dispositivo facial → Sincronizar** |

Faça backup dessa pasta se precisar migrar de PC ou reinstalar.

---

## O que configurar para funcionar bem com o XPE 3200 PLUS IP

### 1. Geral (Configurações)

- **Nome do clube** e **nome do sistema** — textos exibidos na interface.
- **Validade padrão do exame (dias)** e **dias da semana para exames** — usados ao registrar exames.
- **Bloquear exames vencidos** — alinhado às regras de liberação no controle de acessos.

### 2. Videoporteiro Intelbras (IP e porta)

- **IP do dispositivo** — IPv4 com pontos (ex.: `192.168.0.67`).
- **Porta** — em geral **80** para a interface web HTTP do XPE (confira no manual / no aparelho).

Serve para o **teste TCP** (“Conectar” / cartão na visão geral). Não substitui o cadastro facial no próprio equipamento.

### 3. Bridge HTTP (Log de acesso do XPE → PC)

O XPE envia eventos por **HTTP** (manual: **Ações URL** → **Log de Acesso**). O AquaAccess escuta na **rede local** na porta que você definir (padrão sugerido: **37891**).

**Forma mais fácil:** em **Configurações → Assistente Intelbras**, cole a URL do painel do equipamento (ex.: `http://192.168.0.67`) e clique em **Detectar e configurar**. O app detecta o IP deste PC, testa o XPE, liga o bridge e mostra a URL pronta para copiar em **Log de Acesso**.

- Ative **Receber eventos de acesso na rede local** (o assistente faz isso automaticamente).
- Defina **porta** e **path** (padrão do app: `/intelbras/xpe`).
- No XPE, configure a URL apontando para o **IP do computador onde o AquaAccess está em execução**, por exemplo:  
  `http://192.168.0.10:37891/intelbras/xpe?userId=123`  
  O valor `userId` deve ser o **ID do paciente** no AquaAccess (o mesmo número usado como **ID Usuário** no cadastro do XPE) **ou** envie `cpf` com **11 dígitos** se preferir identificar por CPF.
- **Token opcional** — se preencher, o XPE deve enviar o cabeçalho `X-AquaAccess-Token` com o mesmo valor (conforme permitir a configuração do equipamento).
- **Gravar log bruto das requisições** — recomendado ligado no início: cada tentativa vira uma linha em `xpe-bridge-inbound.ndjson`. Use **Abrir log no editor** em Configurações para ver exatamente o que o XPE mandou e ajustar a URL/corpo se necessário.
- **Firewall do Windows** — na primeira vez, autorize o AquaAccess a receber conexões **privadas** na rede quando o Windows perguntar. Sem isso, o XPE não alcança o PC.

### 4. OpenDoor pelo PC (opcional)

Só ative **Chamar OpenDoor via HTTP** se o seu cenário exigir acionar o relé **depois** da validação no app (veja o manual do XPE para `/fcgi/do?action=OpenDoor&...`). Preencha URL base (ex.: `http://192.168.0.67`), usuário e senha web do XPE.

### 5. Fotos e cadastro no XPE

1. No admin: **Dispositivo facial → Sincronizar** — gera pasta com `patient-<id>.*`, CSV e `LEIA-ME.txt`.
2. No **XPE**, cadastre usuários com **ID Usuário** igual ao **ID do paciente** no AquaAccess e associe a foto (interface web / display, conforme manual).

### 6. Automação Playwright (painel web do XPE)

Automação opcional do cadastro no painel web (sem API oficial). Requer Chromium do Playwright instalado na máquina:

```bash
npm install
npm run xpe:install-browser
npm run xpe:test
```

- **Teste isolado:** `npm run xpe:test` abre `http://<IP>` (defaults em `xpeAutomation/config.js`).
- **No app:** **Dispositivo facial → Sincronizar Intelbras** (informa ID do paciente) ou ícone de sync na lista **Pacientes**.
- Credenciais: IP/porta das **Configurações**; usuário/senha web do **bridge OpenDoor** (ou fallback em `xpeAutomation/config.js`).
- Ajuste seletores em `xpeAutomation/selectors.js` após inspecionar o HTML do seu firmware.
- Erros geram screenshots em `%APPDATA%\AquaAccess Facial\xpe-automation-errors\`.

**Build instalador:** o pacote npm inclui o módulo `xpeAutomation/`, mas os browsers do Playwright (~300 MB) não vêm no `.exe` — rode `npm run xpe:install-browser` no PC de destino após instalar.

---

## Perfis de acesso

| Perfil | Após o login |
|--------|----------------|
| **Médico** | `renderer/medico/medico.html` |
| **Administrador** | `renderer/admin/home.html` (telas em `renderer/admin/views/`) |

---

## Funcionalidades principais

- **Cadastro e gestão de pacientes** — nome, CPF, telefone e foto; busca e filtros por situação do exame.
- **Exames médicos** — validade configurável; histórico.
- **Controle de acessos** — eventos liberados/negados (incluindo eventos vindos do bridge XPE).
- **Dispositivo facial** — teste TCP ao XPE; exportação para cadastro no aparelho; status do bridge HTTP.
- **Relatórios** — PDF (impressão) e Excel/CSV.
- **Sincronização** — visão local/nuvem (nuvem ainda placeholder conforme tela).
- **Configurações** — geral, XPE, bridge HTTP, notificações.

---

## Estrutura útil do projeto

```
main.js, preload.js, db.js, xpeBridge.js, xpeAutomation/  → processo principal, bridge HTTP, automação XPE
renderer/login/                           → login
renderer/medico/                        → fluxo médico
renderer/admin/                         → shell admin + views + admin.js
```

Versão em `package.json`: **1.0.0**.
