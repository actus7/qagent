# AGENTS.md

Este repositório usa `pnpm` e é organizado como monorepo. Antes de alterar qualquer coisa, siga estas regras:

- Use `pnpm` para instalar, validar e executar tarefas.
- Prefira comandos com escopo de workspace quando possível.
- Não edite artefatos gerados em `dist/`, `build/` ou `packages/i18n/lib/`.
- Mantenha mudanças pequenas e focadas no arquivo ou módulo afetado.
- Preserve o texto de documentação e interfaces públicas já existentes sempre que não houver motivo para mudar.

## Fluxo recomendado

- `pnpm type-check` para checagem de tipos
- `pnpm lint` para lint com autofix
- `pnpm smoke` para validação ampla antes de publicar
- `pnpm build` para gerar `dist/`

## Publicação como open source

- Este projeto usa licença Apache 2.0.
- Se o modo de debug estiver ligado, a extensão pode exibir eventos, payloads e logs de execução para diagnóstico local.
- Esses dados devem permanecer localmente no storage do Chrome e nos logs da extensão.
- Antes de publicar, confirme que o histórico Git local não contém segredos, tokens ou chaves privadas.
- Verifique workflows e secrets do GitHub antes de ativar qualquer etapa de release automatizada.
