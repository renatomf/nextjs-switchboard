# ADR 0001 — Pipeline de CI

- **Status:** aceito
- **Data:** 2026-09-14
- **Onde:** `.github/workflows/ci.yml`, `lib/db/index.ts`

## Contexto

Até aqui nada era verificado automaticamente: sem CI, e só 55 testes recém-criados. Ao montar o
pipeline, simulamos o CI num checkout limpo (um `git worktree` sem `.env.local`, como no GitHub)
antes do primeiro push. Quatro fatos saíram dessa simulação e moldaram as decisões:

1. **O build dependia de segredos.** `lib/db/index.ts` lançava erro na importação quando faltava
   `DATABASE_URL`, e o `next build` importa todas as rotas para coletar dados de página. Os demais
   clientes em `lib/` (Liveblocks, Browserbase, Resend) já eram criados só no primeiro uso, e o
   README registrava isso como regra do projeto. O banco era a exceção. Localmente o problema não
   aparecia porque existe `.env.local`.
2. **O lint já falhava**, com 2 erros em código gerado pelo shadcn que ninguém importava
   (`components/ui/carousel.tsx` e `hooks/use-mobile.ts`), e varria as pastas de skills de agentes.
3. **O `npm audit` tem 8 alertas altos e 51 moderados**, todos em dependências transitivas.
4. **20 arquivos do projeto estão fora do padrão do Prettier.** No Windows, o `core.autocrlf` ainda
   soma ruído: o Prettier exige LF e o checkout grava CRLF.

## Decisão

- **GitHub Actions com dois jobs em paralelo:** `checks` (lint, typecheck, testes, migrations,
  audit) e `build`. O build, que é a etapa lenta, não atrasa o resto.
- **Checagens independentes dentro do job:** cada passo roda mesmo se um anterior falhou
  (`if: !cancelled()`). Um push mostra todos os problemas de uma vez.
- **Build sem nenhum segredo.** O banco passa a seguir a regra dos outros clientes: `getDb()`
  cria a conexão no primeiro uso.
- **Código morto sai, em vez de ser corrigido.** Os dois arquivos do shadcn e a dependência
  `embla-carousel-react` foram removidos. O shadcn recria qualquer um deles com `npx shadcn add`.
- **Migrations:** `drizzle-kit generate` com uma URL fictícia (ele não conecta) e falha se
  `drizzle/` mudar, ou seja, se alguém alterou o schema sem gerar a migration.
- **Audit bloqueia só alerta crítico em dependência de produção** (`--audit-level=critical --omit=dev`).
- **Segurança do próprio pipeline:** actions fixadas por SHA de commit, `permissions: contents: read`
  e `persist-credentials: false`.
- **Node 24**, o mesmo do worker do Trigger.dev.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| `DATABASE_URL` fictícia no CI | Mais barata, mas esconde a inconsistência: qualquer ambiente de build sem segredos continuaria quebrando |
| Um job por checagem | Cinco instalações de dependências por push. Dois jobs já separam o lento do rápido |
| Audit bloqueando alertas `high` | Os 8 alertas altos já existentes travariam todo PR até uma correção upstream |
| Actions por tag (`@v7`) | Tag é mutável. Em 2025, as tags da `tj-actions/changed-files` foram reapontadas para código malicioso |
| Checar formatação no CI já agora | Exige antes um commit só de formatação dos 20 arquivos; misturar isso aqui tornaria o diff irrevisável |

## Consequências

- ✅ Todo PR passa a mostrar lint, tipos, testes, migrations, audit e build.
- ✅ O build é reproduzível sem credenciais, no CI ou em qualquer máquina.
- ⚠️ Uma `DATABASE_URL` ausente em produção passa a falhar na primeira query, não na inicialização.
  É o mesmo comportamento que o projeto já tinha escolhido para os outros clientes.
- ⚠️ SHAs fixos não se atualizam sozinhos. Falta um Dependabot para as actions.
- ⚠️ Alertas altos e moderados não bloqueiam o merge e precisam ser acompanhados à parte.
- ⚠️ O cache de build do Next (`.next/cache`) não é reaproveitado entre runs; o build no CI fica
  mais lento do que poderia.
