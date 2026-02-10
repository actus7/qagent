# AQgent

Extensão de navegador que opera como um agente de QA (Quality Assurance) automatizado, utilizando sistema multi-agente com LLMs.

## Setup

### Pré-requisitos

- [Node.js](https://nodejs.org/) v22.12.0+
- [pnpm](https://pnpm.io/installation) v9.15.1+

### Instalação

```bash
pnpm install
```

### Desenvolvimento

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

A extensão será gerada no diretório `dist/`.

### Carregar no Chrome

1. Abra `chrome://extensions/`
2. Ative o "Modo do desenvolvedor"
3. Clique em "Carregar sem compactação"
4. Selecione o diretório `dist/`

## Licença

Apache License 2.0
