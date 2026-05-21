# AQgent

Extensão de navegador para QA automatizado com um sistema multi-agente e suporte a múltiplos provedores de LLM.

## Visão geral

O AQgent executa tarefas de automação e validação diretamente no navegador, combinando navegação, planejamento e validação em um fluxo local.

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

O runtime usa `BrowserManager` (`agent-browser`) como engine padrão. Para iniciar o companion local:

```bash
pnpm companion:agent-browser
```

No ambiente local, mantenha algo como:

```bash
VITE_BROWSER_ENGINE=agent-browser
VITE_AGENT_BROWSER_WS_URL=ws://127.0.0.1:9223
```

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
