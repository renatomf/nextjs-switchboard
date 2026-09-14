# Roadmap de evolução

Plano para levar o Switchboard de um projeto com produto forte e processo fraco a um projeto que
mostra engenharia de nível sênior, sem transformá-lo em um template de arquitetura.

**Regra para qualquer passo:** um padrão, camada ou abstração só entra se resolver um problema que
dá para apontar no código, ou se baratear uma mudança que vamos de fato fazer.

Cada passo segue o mesmo ciclo: explicar o problema, implementar em mudanças pequenas (com teste
primeiro onde houver lógica), mostrar como verificar, e registrar um ADR quando houver decisão.
As decisões ficam em [`docs/adr/`](adr/).

| Após | Nota estimada |
| --- | :-: |
| Ponto de partida | 6,5 |
| Fases A + B | 8 |
| + C | 8,5–9 |
| + D + E | 9–9,5 |

---

## Fase A — Fundação

- [x] **A.1** Vitest + testes de caracterização das partes puras (`validateGraph`, `interpolate`)
- [x] **Extra** Next.js 16.2.6 → 16.3.5 por alertas críticos de segurança (achado da A.1)
- [x] **A.2** Testes das demais partes puras (`premium-gate`, `toWorkflowRun`)
- [x] **A.3** CI no GitHub Actions: lint, typecheck, test, build, migration pendente e `npm audit`
      ([ADR 0001](adr/0001-pipeline-de-ci.md)). Verde no PR #1 e na `main`
- [x] **A.3b** Limpeza e formatação: 42 componentes shadcn sem uso e as 7 dependências só deles,
      scaffolding de setup, `.gitattributes` com `eol=lf`, Prettier em todo o código, checagem de
      formatação no CI, `.git-blame-ignore-revs` e o knip barrando código morto no CI
- [x] **A.3c** Dependabot para as actions e o npm, com grupos para o que precisa andar junto e um
      período de espera para versões recém-publicadas
- [x] **A.5** Corrigir o IDOR do cancel (`runs.cancel` sem checar a org dona da run): a action
      prova a posse em dois passos (workflow da org, run do workflow), com a política
      `isRunOfWorkflow` escrita em TDD e um teste de regressão de segurança na action
- [x] **A.6** Índice `(org_id, created_at)` em `workflows`, para a listagem por org não varrer a tabela
      inteira (migration `0002`)
- [x] **A.7** Remover o `db:push`: ele aplicou a `0001` sem registrá-la, e o `db:migrate` quebrou
      ao tentar reaplicá-la. O schema agora só muda por `db:generate` + `db:migrate`

## Fase B — Execution como núcleo

- [x] **B.1** Versões imutáveis de workflow: rascunho no Liveblocks, versão publicada no Postgres.
      Corrige a race condition entre salvar o grafo e a task lê-lo
      ([ADR 0002](adr/0002-versoes-imutaveis-de-workflow.md))
- [ ] **B.2** Tabelas `executions` e `execution_steps`, atualizadas pelos hooks do Trigger.dev.
      Corrige o IDOR do replay (hoje não há como ligar um `sessionId` a uma org)
- [ ] **B.3** Aggregate `Execution` com state machine, em TDD; status `cancelled` no step
- [ ] **B.4** Engine extraído da task, com ports `BrowserPort` e `ProgressReporter`

## Fase C — Confiabilidade

- [ ] **C.1** Concorrência: `concurrencyKey` por workflow (limite 1) e por org, com limite por plano
- [ ] **C.2** Idempotência no Run e no Send Email (`idempotencyKey` da Resend = `runId:nodeId`)
- [ ] **C.3** Taxonomia de erros, retry por nó na mesma sessão, `AbortTaskRunError`, timeout por nó
- [ ] **C.4** Testes de falha (browser fake que falha N vezes) e de dois Runs simultâneos

## Fase D — Features que puxam arquitetura (escolher 3–4)

- [ ] Workflows agendados (cron)
- [ ] Trigger por webhook (HMAC, rate limiting, `Idempotency-Key`)
- [ ] Cofre de credenciais (criptografia envelope, segredo fora de log e de prompt)
- [ ] Artifacts: screenshots e extrações em object storage
- [ ] Metering e quotas por org, ligados ao Clerk Billing

## Fase E — Evidência de produção

- [ ] Preview por PR: deploy de preview na Vercel + branch do Neon por PR. Veio da antiga A.4:
      depende de configurar os painéis da Vercel e do Neon e de chaves por ambiente, que esta fase monta
- [ ] E2E com Playwright + Clerk testing, usando executor fake
- [ ] Deploy de produção real (Clerk de produção, domínio na Resend, chave própria do modelo)
- [ ] Métricas e SLOs: taxa de sucesso, p95 de duração, custo por execução
- [ ] Postmortem: o `metadata.set` que descartava updates por deep-equal
- [ ] Documento "Como isso escala 100x"

---

## Achados durante o caminho

Problemas encontrados ao trabalhar em um passo, mas fora do escopo dele. Ficam registrados aqui
em vez de serem corrigidos no meio de outra mudança. Os que têm teste de caracterização estão no
bloco `current gaps` do arquivo de teste correspondente.

| Achado | Onde | Gravidade | Destino |
| --- | --- | :-: | --- |
| ~~Next.js 16.2.6 tem 2 alertas críticos de RCE e vários altos (bypass de proxy, SSRF, DoS)~~ | `package.json` | ✅ | Resolvido: Next 16.3.5, com versão exata |
| ~~O build dependia de `DATABASE_URL`: `lib/db` lançava erro na importação, ao contrário dos outros clientes~~ | `lib/db/index.ts` | ✅ | Resolvido na A.3: `getDb()` no primeiro uso |
| ~~`npm run lint` falhava com 2 erros em código morto do shadcn e 2 avisos; o ESLint varria `.agents/`~~ | lint | ✅ | Resolvido na A.3 |
| ~~As páginas de exemplo do Sentry iam para produção e geravam erros falsos para qualquer visitante~~ | `app/sentry-example-page` | ✅ | Resolvido na A.3b |
| ~~20 arquivos fora do padrão do Prettier, com ruído de CRLF no Windows~~ | vários | ✅ | Resolvido na A.3b |
| ~~A `0001` tinha sido aplicada com `db:push` e nunca registrada, então o `db:migrate` falhava ao reaplicá-la e desfazia a `0002`~~ | banco | ✅ | Resolvido: baseline da `0001` e A.7 |
| `.claude/skills` guarda 13 skills como junções do Windows apontando para `.agents/skills`, onde o instalador de skills as mantém. Apagar a `.agents/` quebra essas skills do Claude | `.agents/`, `.claude/` | 🟡 | Saber que existe |
| `npm audit` aponta 64 alertas (1 crítico, 11 altos, 52 moderados), todos em dependências transitivas ou na CLI do Trigger. Nas dependências de produção, que o CI bloqueia, são 6 altos e nenhum crítico | `package-lock.json` | 🟠 | O CI bloqueia só crítico em produção; acompanhar à parte |
| A CLI do Trigger.dev (4.5.16, e também a 4.6.0) traz o `tar` 6.2.1 vulnerável pela cadeia `c12` 1.x → `giget` 1.x. O `giget` 2 já não usa `tar`, mas o Trigger ainda está preso ao `c12` 1.x. É o mesmo código que o `.mcp.json` já roda via `npx` | `trigger.dev` (devDependency) | 🟠 | Aceito; acompanhar a atualização upstream do `c12` |
| O CI não reaproveita o cache de build do Next (`.next/cache`) | `ci.yml` | 🟡 | Otimização futura |
| Depois de apagar uma rota, o `typecheck` local falha até o `next build` ou o `next dev` regenerar `.next/types` (no CI não acontece) | `tsconfig.json` | 🟡 | Saber que existe |
| ~~Uma aresta apontando para um nó inexistente passava no `validateGraph`, mas a run quebrava no `toposort.array` com "Unknown node"~~ | `validate-graph.ts` | ✅ | Resolvido na B.1 |
| ~~Um Start desconectado passava na validação, e a run executava passos que o Start não alcança~~ | `validate-graph.ts` | ✅ | Resolvido na B.1 |
| `interpolate` não codifica valores usados dentro de uma URL: `a b&page=2` vira um parâmetro extra | `interpolate.ts` | 🟡 | Backlog |
