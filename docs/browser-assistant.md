# Assistente de navegador QAgent

## Referências inspecionadas

Análise local realizada em 21/10/2026, nos arquivos distribuídos das extensões instaladas no Comet:

| Extensão | ID | Versão | Evidências |
| --- | --- | --- | --- |
| Claude | `fcoeoabgfenejglbffodgkkbkcdhcgfn` | `1.0.101` | Manifesto, bundle do sidepanel: `read_page`, `tabs_context`, `tabs_create`, `execute_javascript`, aprovações, indicadores de atividade e screenshots. |
| ChatGPT / Codex | `hehggadaopoacecdllhhajmbjkdcmajg` | `1.26.1015.10801` | Manifesto, `background.js`, `codex-work-sidepanel`: painel associado à superfície `browser_side_chat`, contexto e menções de abas, controle via CDP/native messaging e políticas de aprovação. |

Foram utilizados os manifestos e trechos dos bundles para entender os comportamentos e os limites entre interface, modelo e navegador. Código, ativos, chaves de assinatura, credenciais e sessões das extensões não foram incorporados ao QAgent.

## Arquitetura

- O service worker continua sendo a autoridade de execução. Mensagens tipadas e validadas conectam o painel ao runtime.
- `ScopedBrowserContext` reutiliza o motor CDP existente. Filtra a lista de abas e valida o escopo e o firewall antes de anexar, alternar ou fechar uma aba. Abas criadas pela tarefa entram no escopo.
- Conversar e Planejar usam `chrome.scripting` para ler o texto renderizado das páginas selecionadas, sem anexar o debugger. O contexto é limitado a 12 abas, 18 mil caracteres por página e tratado como conteúdo externo não confiável.
- O modelo recebe até 20 mensagens recentes da conversa. O streaming usa cancelamento e limite de dois minutos; apenas respostas completas entram no histórico. O conteúdo parcial pode permanecer visível na conversa atual após uma interrupção.
- Executar mantém o planejador, navegador e registro de ações existentes. O modelo de navegação pode ser selecionado no compositor; o planejador usa a configuração já existente.
- No modo de aprovação, cada ação que altera a página ou navegação aguarda uma resposta associada ao ID da tarefa e da solicitação. Aprovações expiram após cinco minutos e são invalidadas se a URL mudar. Recusa, cancelamento e fechamento do painel encerram ações pendentes.
- O modo automático é uma escolha explícita no compositor. O escopo de abas e o firewall continuam sendo aplicados.
- Respostas do assistente são persistidas pelo background. O painel renderiza Markdown sem HTML arbitrário e transforma imagens remotas em links, evitando carregamentos automáticos.
- Gravações de mensagens são serializadas entre painel e service worker com Web Locks e leem o storage antes de anexar uma mensagem, para preservar respostas em continuações da conversa.
- Histórico, provedores e configurações existentes são preservados. Debug continua local.

## Limites de compatibilidade

O QAgent reproduz os fluxos principais com implementação própria e provedores configuráveis. Não é uma reprodução integral das extensões proprietárias. Login, assinaturas Claude/ChatGPT, serviços privados de bridge/native messaging, tarefas agendadas, bibliotecas proprietárias e ferramentas exclusivas desses serviços não são fornecidos por esta implementação. O usuário configura seu próprio provedor/API ou modelo local.

O Chrome mostra seu indicador de depuração quando uma tarefa controla uma aba. Outra extensão ou DevTools pode disputar esse controle. Páginas internas do navegador e a Chrome Web Store não aceitam automação por este painel.

No Comet 155.0.8059.40, foi reproduzido o erro `Host access is restricted by policy.` na chamada `chrome.debugger.attach`, em perfil isolado, tanto em `https://www.ideal.dev.br/` quanto em `https://example.com/`. As permissões de host estavam concedidas e a leitura por `chrome.scripting.executeScript` funcionou nas duas páginas. O relatório de políticas fornecido pelo usuário estava vazio; esse erro, isoladamente, não comprova uma política administrativa. As mesmas chamadas funcionaram no Chromium. Nesse caso, Conversar/Planejar podem usar a leitura da página; para Executar com o motor nativo, carregue `dist/` em Chrome/Chromium. O QAgent não altera as restrições do navegador.

O companion continua opcional, por meio de `VITE_BROWSER_ENGINE=agent-browser`. Nesse modo, as ações acontecem no navegador isolado e a prévia é mantida. O isolamento por IDs de abas descrito acima pertence ao motor nativo.

## Validação

Use `pnpm smoke` para tipos, lint, testes e build. Os testes adicionais cobrem escopo de abas, aprovação/cancelamento, firewall, streaming e persistência. Não execute um build que limpa os pacotes gerados ao mesmo tempo que testes que dependem desses pacotes.

No Windows, se `bash` apontar para um WSL sem Node, coloque o Git Bash no PATH do processo antes de rodar a validação:

```powershell
$env:Path = 'C:\Program Files\Git\bin;' + $env:Path
pnpm smoke
```

Para carregar, abra `chrome://extensions/`, ative o modo desenvolvedor e escolha **Carregar sem compactação**, selecionando `dist/`. No Comet, a mesma tela fica em `comet://extensions/`.

### Resultado da verificação de 21/10/2026

- Tipos e lint do monorepo aprovados; `pnpm smoke` concluído com Git Bash.
- Execução direta da suíte: 58 testes aprovados em 16 arquivos.
- Extensão compilada carregada em perfil isolado do Chromium, com provedor OpenAI compatível de teste servido em localhost.
- Verificados: leitura da página, streaming, Markdown com tabela, continuidade com respostas anteriores, planejamento sem ações e transferência do plano para execução.
- Clique real via CDP confirmado no DOM da página: aguarda aprovação no modo de confirmação e executa diretamente no modo automático.
- Recusa encerra a fila sem modificar a página nem registrar uma conclusão falsa. Interromper streaming não persiste uma resposta incompleta.
- Histórico restaurado e editável, anexos de texto presentes na requisição ao modelo, tema escuro e largura de 320 px sem overflow horizontal.
- ZIP inspecionado com manifesto, worker, content script e painel; contém 32 entradas e nenhum perfil ou arquivo local de teste.

Os testes de navegador usaram respostas controladas do provedor local. Não utilizaram contas ou credenciais das extensões oficiais, nem validaram uma chamada de produção a um provedor externo.
