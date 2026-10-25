# AQgent

Assistente de navegador com conversa, planejamento e execução de tarefas, com suporte a múltiplos provedores de LLM.

## Visão geral

O AQgent executa tarefas de automação e validação diretamente no navegador, combinando navegação, planejamento e validação em um fluxo local.

## Assistente lateral

O painel oferece três modos:

- **Conversar**: responde sobre as páginas selecionadas, com streaming e Markdown, sem ferramentas de interação.
- **Planejar**: lê o contexto e propõe um plano. O botão de execução transfere esse plano para o compositor no modo Executar.
- **Executar**: interage com as abas do próprio navegador usando `chrome.debugger`. O acesso fica limitado às abas selecionadas e às abas criadas pela tarefa.

Escolha as páginas no seletor de abas, configure um provedor em Configurações e selecione um dos modelos configurados no compositor. O agente executa as ações sem pedir confirmação, inclusive compras e ações sensíveis. Interromper a tarefa cancela a execução.

O histórico permanece local e permite continuar conversas anteriores. Anexos de texto, ditado, prompts salvos, firewall e replay continuam disponíveis. O atalho `Ctrl+Shift+.` abre o painel, caso não esteja atribuído a outra extensão; ele pode ser alterado em `chrome://extensions/shortcuts`.

A implementação e as diferenças em relação às extensões usadas como referência estão documentadas em [docs/browser-assistant.md](docs/browser-assistant.md).

Principais áreas do projeto:

- `chrome-extension/` para o service worker e a lógica central da extensão
- `pages/side-panel/` para a interface principal
- `packages/` para utilitários compartilhados, storage, UI e i18n

## Requisitos

- [Node.js](https://nodejs.org/) v22.19.0+
- [pnpm](https://pnpm.io/installation) v9.15.1+

## Instalação

```bash
pnpm install
```

## Desenvolvimento

```bash
pnpm dev
```

Esse comando inicia o modo watch da extensão e sobe automaticamente o companion do `BrowserManager`.
Para manter o TUI limpo, os logs do companion ficam em `.logs/companion.log`.

## Companion local

O runtime usa as abas nativas por padrão e não precisa do companion. Para optar pelo navegador isolado `BrowserManager` (`agent-browser`), configure `VITE_BROWSER_ENGINE=agent-browser` e inicie o companion local:

```bash
pnpm companion:agent-browser
```

No ambiente local, mantenha algo como:

```bash
VITE_BROWSER_ENGINE=chrome-debugger
VITE_AGENT_BROWSER_WS_URL=ws://127.0.0.1:9223
```

Segurança do companion: ele só aceita conexões da extensão (`Origin: chrome-extension://…`) ou de clientes locais sem `Origin`; páginas web são recusadas. Variáveis opcionais do processo do companion:

- `AGENT_BROWSER_EXTENSION_ID` — aceita apenas o ID exato da sua extensão (recomendado).
- `AGENT_BROWSER_WS_TOKEN` — exige um token no handshake (configure o mesmo valor em `VITE_AGENT_BROWSER_WS_TOKEN`).
- `AGENT_BROWSER_ALLOW_FILE_ACCESS=true` — libera `upload` por caminho local e `screenshotPath` (desligado por padrão).

## Política gerenciada (organizações)

Administradores podem limitar quais provedores de LLM o AQgent usa pela política gerenciada do Chrome (`chrome.storage.managed`, esquema em `chrome-extension/public/managed-schema.json`). A política não restringe as ações do agente.

| Chave | Tipo | Efeito |
|---|---|---|
| `allowedProviders` | `string[]` | Provedores permitidos (id ou tipo, ex.: `openai`, `anthropic`, `ollama`). Outros são recusados. |

Quando alguma restrição está ativa, o painel lateral mostra "Gerenciado pela sua organização".

## Ponte local (`qagent`): clientes MCP, agentes CLI e ferramentas do host

A ponte é o pacote `@qagent/bridge` (`packages/bridge`), com o comando `qagent`. Ela roda como um daemon local que a extensão acessa por WebSocket e que os clientes acessam por um canal de controle. Tudo escuta só em `127.0.0.1`, e cada lado prova o token antes de trocar mensagens (HMAC-SHA256 mútuo; o token bruto não trafega).

**Instalação**

```bash
pnpm -F @qagent/bridge build                 # no repositório
npm install -g ./packages/bridge             # instala o comando `qagent` (ou: npx -p ./packages/bridge qagent)
```

**Pareamento e início**

1. `qagent pair` cria (ou mostra) o token compartilhado e imprime os passos. `qagent pair --rotate` troca o token; daemons e extensões precisam ser atualizados depois.
2. Em **Opções da extensão > Controle por clientes MCP**, ative a ponte e cole o token.
3. `qagent start` roda o daemon em primeiro plano (Ctrl+C encerra). `qagent status` mostra o estado; `qagent stop` encerra.

**Registro nos clientes MCP**

```bash
claude mcp add qagent -- qagent mcp
codex mcp add qagent -- qagent mcp
```

O servidor MCP usa o daemon em execução. Sem daemon, ele inicia a ponte no próprio processo. Além de `qagent_run_task`, `qagent_list_tabs`, `qagent_get_status` e `qagent_cancel_task`, cada ação do navegador vira uma ferramenta: `page_info`, `page_click`, `page_fill` etc. Todas aceitam `tabId` opcional.

**Agente CLI como provedor**

Em **Opções > Agente CLI**, escolha Claude Code ou Codex. A partir daí as tarefas do modo *act* do painel são executadas pela CLI no daemon, e os passos aparecem no painel como passos normais do agente. A CLI dirige o navegador pelo servidor MCP `qagent`. Ela roda sem pedidos de aprovação, porque o produto não tem essas travas. O executável é encontrado no PATH; `QAGENT_CLAUDE_BIN` e `QAGENT_CODEX_BIN` apontam para outro caminho. Os modos *chat* e *plan* continuam com o agente interno.

**Ferramentas de host para o agente interno**

`shell_exec`, `fs_read`, `fs_write`, `fs_list` e `fs_search` rodam na máquina do daemon, pela ponte. Sem ponte conectada, a ação falha com uma mensagem clara e nada roda localmente. A saída é limitada em tamanho e entra no contexto do modelo como conteúdo não confiável.

**Variáveis de ambiente**

`QAGENT_HOME` (diretório de estado, padrão `~/.qagent`, onde fica `config.json` com o token), `QAGENT_MCP_TOKEN` (substitui o token salvo), `QAGENT_MCP_PORT` (padrão `9224`, para a extensão), `QAGENT_CONTROL_PORT` (padrão `9225`, para clientes locais), `QAGENT_CLAUDE_BIN`, `QAGENT_CODEX_BIN`.

**Segurança**

Os dois canais escutam só em loopback. O canal de controle exige o token em `Authorization: Bearer` e recusa requisições com `Origin`, então uma página web não o alcança. O socket da extensão exige o handshake mútuo e aceita só `chrome-extension://`. Sem token de 32 caracteres ou mais, nada inicia.

**Modo de desenvolvimento**

`pnpm mcp:qagent` roda o servidor MCP a partir do código do repositório (compila o pacote antes). Para o Codex, prefira `codex mcp add qagent -- qagent mcp` depois de instalar o comando.

## Build

```bash
pnpm build
```

A extensão é gerada em `dist/`.

## Verificações

```bash
pnpm smoke
```

Esse comando executa:

- `pnpm type-check`
- `pnpm -r --if-present lint`
- `pnpm -r --if-present test`
- `pnpm build`

Variações úteis:

- `pnpm smoke:quick` para validar sem build final
- `pnpm smoke:zip` para incluir o pacote de distribuição

## Carregar no Chrome

1. Abra `chrome://extensions/`
2. Ative o modo do desenvolvedor
3. Clique em "Carregar sem compactação"
4. Selecione o diretório `dist/`

## Debug, logs e privacidade

O modo `chatDebugMode` é uma configuração explícita de diagnóstico. Quando ele está ativado, a interface passa a exibir eventos e payloads da execução para facilitar troubleshooting.

Esse modo também habilita logs verbosos no background, e o projeto pode registrar informações de execução da página ativa, incluindo console logs e network logs, quando isso for necessário para diagnóstico.

Esses dados ficam apenas no ambiente local do usuário, armazenados no storage local do Chrome e nos artefatos de log da extensão. Eles não devem ser tratados como telemetria remota.

## Publicação como código aberto

Antes de publicar este repositório, revise o histórico local para garantir que nenhum commit antigo contenha segredos, tokens ou chaves privadas.

Também verifique se os workflows e secrets do GitHub estão configurados corretamente no repositório antes de habilitar qualquer etapa de release automatizada.

## Licença

Este projeto está licenciado sob os termos da [Apache License 2.0](LICENSE).
