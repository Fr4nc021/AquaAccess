# POC: médico no browser → Intelbras XPE

Mini site local (porta **3847**) para validar cadastro facial no painel do XPE: o médico informa **nome + foto**, o sistema gera o **ID** e o Playwright preenche **ID Usuário**, **Nome**, **Facial → Selecionar** e **Aplicar**.

Não grava no AquaAccess neste POC.

## Pré-requisitos

1. Node.js no PC do clube (mesma pasta do repo AquaAccess Facial).
2. Dependências: `npm install` na raiz do projeto.
3. Chromium do Playwright: `npm run xpe:install-browser`
4. Rede até o XPE (ex.: `http://192.168.15.44`).

## Configuração

Edite `medico-web/config.json` (ou copie de `config.example.json`):

| Campo | Exemplo | Notas |
|--------|---------|--------|
| `xpeUrl` | `http://192.168.15.44` | IP/URL do painel web |
| `xpeUser` | `admin` | Usuário web do XPE |
| `xpePassword` | *(senha real)* | **Obrigatório** — não use a senha de fábrica se já foi alterada |
| `listenPort` | `3847` | Porta do site |
| `listenHost` | `0.0.0.0` | `0.0.0.0` = acessível na LAN |
| `headless` | `false` | `false` mostra o Chromium (útil no primeiro teste) |

## Como rodar

Na raiz do repositório:

```bash
npm run medico:web
```

Abra no Chrome:

- Neste PC: `http://127.0.0.1:3847`
- Outro PC/tablet na LAN: `http://<IP-do-PC>:3847` (ex.: `http://192.168.15.4:3847`)

## Teste no clube (critério de sucesso)

1. Abrir o site na porta 3847.
2. Preencher **Nome**, tirar/enviar **foto**, clicar **Salvar e enviar ao XPE**.
3. Aguardar o status (pode levar ~30–90 s com a janela do Playwright).
4. Abrir o painel do XPE → **Controle de Acesso** → **Usuários**.
5. Confirmar o **mesmo ID** na lista e a face **não** em “Sem registro”.

Se falhar: mensagem no site + screenshot em `medico-web/data/errors/`. Histórico local em `medico-web/data/registry.json`.

## Observações

- IDs são sequenciais a partir de 1 (máx. 11 caracteres no firmware).
- Foto é convertida para **JPEG** no navegador antes do envio.
- Um cadastro por vez (evita dois Playwrights ao mesmo tempo).
- AquaAccess **não** precisa estar aberto para este POC.
