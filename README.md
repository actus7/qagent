# AQgent

Assistente de navegador com conversa, planejamento e execução de tarefas, com suporte a múltiplos provedores de LLM.

## Visão geral

O AQgent executa tarefas de automação e validação diretamente no navegador, combinando navegação, planejamento e validação em um fluxo local.

## Assistente lateral

O painel oferece três modos:

- **Conversar**: responde sobre as páginas selecionadas, com streaming e Markdown, sem ferramentas de interação.
- **Planejar**: lê o contexto e propõe um plano. O botão de execução transfere esse plano para o compositor no modo Executar.
- **Executar**: interage com as abas do próprio navegador usando `chrome.debugger`. O acesso fica limitado às abas selecionadas e às abas criadas pela tarefa.

Escolha as páginas no seletor de abas, configure um provedor em Configurações e selecione um dos modelos configurados no compositor. O modo Executar pergunta antes de ações por padrão; a opção **Agir automaticamente** permite executá-las sem essa pausa. Recusar uma ação ou interromper a tarefa cancela a execução.

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

Administradores podem restringir o AQgent pela política gerenciada do Chrome (`chrome.storage.managed`). O esquema está em `chrome-extension/public/managed-schema.json`. Todas as chaves são opcionais; sem política gerenciada não há restrições.

| Chave | Tipo | Efeito |
|---|---|---|
| `blockedUrlPatterns` | `string[]` | URLs que o AQgent nunca acessa. Vale também sem firewall ativo. |
| `allowedUrlPatterns` | `string[]` | Se definida, só essas URLs podem ser acessadas. |
| `disableAutoMode` | `boolean` | Remove o modo "Agir automaticamente" e força perguntar em todas as ações. |
| `disableJavascriptTool` | `boolean` | Desativa a ação `execute_javascript`. |
| `disableFileUpload` | `boolean` | Desativa as ações de envio de arquivo. |
| `allowedProviders` | `string[]` | Provedores permitidos (id ou tipo, ex.: `openai`, `anthropic`, `ollama`). Outros são recusados. |

Padrões de URL aceitam `*` como coringa. `exemplo.com` cobre o host e os subdomínios; `*.exemplo.com` é equivalente; `intranet.acme.com/app/*` restringe o caminho. Um esquema (`https://`) é opcional.

Exemplo (`managed-policy.json`, para publicação via gerenciamento de políticas do Chrome):

```json
{
  "blockedUrlPatterns": ["bank.example.com", "*.payments.example.com/*"],
  "allowedUrlPatterns": [],
  "disableAutoMode": true,
  "disableJavascriptTool": true,
  "disableFileUpload": false,
  "allowedProviders": ["anthropic", "ollama"]
}
```

Quando alguma restrição está ativa, o painel lateral mostra "Gerenciado pela sua organização".

## Controle por clientes MCP (Claude Code, Codex CLI)

O AQgent pode ser controlado por clientes MCP locais. A opção fica desligada por padrão e é ativada em **Configurações gerais > Permitir controle por clientes MCP locais**. Ela conecta a extensão, por WebSocket, a um servidor MCP local em `127.0.0.1:9224`.

Ferramentas expostas:

- `qagent_run_task`: executa uma tarefa (`task`, `mode` = `chat` | `plan` | `act`, `permission` = `ask` | `auto`, `url` opcional) e aguarda a conclusão. Retorna a resposta final e o resumo dos passos.
- `qagent_list_tabs`: lista as abas http(s), com URL sem query e se o AQgent pode usá-las.
- `qagent_get_status`: mostra se há conexão, tarefa em andamento e painel aberto.
- `qagent_cancel_task`: cancela a tarefa em andamento.

Segurança: o servidor só escuta em loopback, recusa origens de páginas web e aceita apenas a extensão (`QAGENT_MCP_EXTENSION_ID`) com o token compartilhado (`QAGENT_MCP_TOKEN`). Cada tarefa passa pelo mesmo pipeline do painel, com as mesmas regras de política e firewall. No modo `ask`, as aprovações aparecem no painel lateral, que precisa estar aberto.

Variáveis de ambiente do servidor: `QAGENT_MCP_PORT` (padrão `9224`), `QAGENT_MCP_TOKEN`, `QAGENT_MCP_EXTENSION_ID`, `QAGENT_MCP_TASK_TIMEOUT_MS` (padrão 10 minutos).

Registro no Claude Code (use `--silent` para o pnpm não escrever no stdout, que transporta o protocolo):

```bash
claude mcp add qagent -e QAGENT_MCP_TOKEN=seu-token -- pnpm --silent --dir <caminho-do-repo> mcp:qagent
```

Registro no Codex CLI, em `~/.codex/config.toml`:

```toml
[mcp_servers.qagent]
command = "pnpm"
args = ["--silent", "--dir", "<caminho-do-repo>", "mcp:qagent"]

[mcp_servers.qagent.env]
QAGENT_MCP_TOKEN = "seu-token"
```

Antes de usar, rode `pnpm build` e carregue a extensão em `dist/`.

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
