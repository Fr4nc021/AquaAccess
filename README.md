# AquaAccess (facial)

Aplicação desktop **offline-first** para **controle de acesso às piscinas do clube**, com cadastro de associados, validação de exames médicos e integração com **reconhecimento facial Intelbras**.

## Stack

- **Electron** (janela principal e IPC)
- **sql.js** — banco SQLite local
- **bcryptjs** — autenticação de usuários

## Como executar

```bash
npm install
npm start
```

A janela abre em `renderer/login/login.html`.

## Perfis de acesso

| Perfil | Após o login |
|--------|----------------|
| **Médico** | `renderer/medico/medico.html` |
| **Administrador** | `renderer/admin/home.html` (telas injetadas a partir de `renderer/admin/views/`) |

O login permite escolher o tipo de acesso (aba Médico / Administrador) e valida credenciais contra o banco local.

## Funcionalidades principais (visão de produto)

- **Cadastro e gestão de pacientes** — nome, CPF, telefone e foto; busca e filtros por situação do exame.
- **Exames médicos** — registro com validade configurável (padrão em dias nas configurações); histórico de exames realizados.
- **Controle de acessos** — acompanhamento de eventos na entrada (liberados / negados), com indicadores do dia.
- **Dispositivo facial** — status de conexão, métricas de sincronização e ações enviadas ao leitor (IP/porta definidos em Configurações).
- **Relatórios** — período customizável, atalhos “esta semana / este mês”, exportação para **PDF** (impressão) e **Excel/CSV**.
- **Sincronização** — visão do banco local, nuvem (Supabase) e pendências; ação de sincronizar tudo.
- **Configurações** — nome do clube e do sistema, validade padrão de exame, parâmetros do dispositivo Intelbras, opções de auto-sync, bloqueio de vencidos e preferências de notificação.

> Parte da interface administrativa (por exemplo, gráficos na visão geral) pode usar valores de exemplo no HTML; os dados operacionais vêm do banco e dos handlers em `main.js` / `db.js`.

## Telas criadas até o momento

### Autenticação

| Tela | Arquivo | Conteúdo resumido |
|------|---------|-------------------|
| Login | `renderer/login/login.html` | Identidade visual AquaAccess, abas Médico/Administrador, formulário usuário/senha, lembrar conexão |

### Painel médico

| Tela | Arquivo | Conteúdo resumido |
|------|---------|-------------------|
| Shell + Pacientes | `renderer/medico/medico.html` | Sidebar, busca no topo, formulário “Incluir novo paciente” (foto, dados, validar exame), tabela somente leitura de pacientes com filtro de atenção |
| Exames feitos | Mesmo arquivo (`#view-exames`) | Tabela somente leitura de exames realizados; navegação por aba no menu lateral |
| Modal excluir paciente | Mesmo arquivo | Confirmação antes de remover cadastro |

### Painel administrativo

O layout base e o menu estão em `renderer/admin/home.html`. O conteúdo de cada seção é carregado dinamicamente a partir dos fragmentos abaixo (`admin-views-loader.js`).

| Tela / módulo | Arquivo | Conteúdo resumido |
|---------------|---------|-------------------|
| Visão geral | `renderer/admin/views/visao-geral.html` | Cards de resumo (pacientes, exames, acessos, sistema, dispositivo), gráfico de exames por mês, distribuição por status; **tela inicial** do admin (marca no sidebar também volta para esta visão) |
| Pacientes | `renderer/admin/views/pacientes.html` | Busca, filtros (todos, válido, vencendo, vencido, bloqueado), tabela com ações; modais de edição, confirmação e alerta |
| Controle de acessos | `renderer/admin/views/controle-acessos.html` | Totais do dia (liberados/negados), lista de eventos recentes em tempo real |
| Dispositivo facial | `renderer/admin/views/dispositivo-facial.html` | Resumo do leitor, status, métricas e painel de ações |
| Relatórios | `renderer/admin/views/relatorios.html` | Filtros de período, export PDF/Excel, foco em exames vencendo e contato |
| Sincronização | `renderer/admin/views/sincronizacao.html` | Status local/nuvem/pendências e botão sincronizar tudo |
| Exames realizados | `renderer/admin/views/exames.html` | Tabela histórica com ações administrativas |
| Configurações | `renderer/admin/views/configuracoes.html` | Formulário: geral, Intelbras, notificações e demais parâmetros |

### Estilos e recursos compartilhados

- `renderer/shared/base.css` — estilos base
- `renderer/public/` — logos e ícones usados nas telas

## Estrutura útil do projeto

```
main.js, preload.js, db.js   → processo principal, ponte segura renderer↔main, persistência
renderer/login/              → login
renderer/medico/             → fluxo médico
renderer/admin/            → shell admin + views + admin.js
```

---

Versão declarada em `package.json`: **1.0.0**.
