# Roadmap de evolução

Plano para levar o Switchboard de um projeto com produto forte e processo fraco a um projeto que
mostra engenharia de nível sênior, sem transformá-lo em um template de arquitetura.

**Regra para qualquer passo:** um padrão, camada ou abstração só entra se resolver um problema que
dá para apontar no código, ou se baratear uma mudança que vamos de fato fazer.

Cada passo segue o mesmo ciclo: explicar o problema, implementar em mudanças pequenas (com teste
primeiro onde houver lógica), mostrar como verificar, e registrar um ADR quando houver decisão.

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
- [ ] **A.2** Testes das demais partes puras (`premium-gate`, `toWorkflowRun`)
- [ ] **A.3** CI no GitHub Actions: lint, typecheck, test, build, migration pendente e `npm audit`
- [ ] **A.4** Preview por PR: deploy de preview na Vercel + branch do Neon por PR
- [ ] **A.5** Corrigir o IDOR do cancel (`runs.cancel` sem checar a org dona da run)
- [ ] **A.6** Índice `(org_id, created_at)` em `workflows`

## Fase B — Execution como núcleo

- [ ] **B.1** Versões imutáveis de workflow: rascunho no Liveblocks, versão publicada no Postgres.
      Corrige a race condition entre salvar o grafo e a task lê-lo
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
| `npm audit` aponta 59 alertas (8 altos, 51 moderados, nenhum crítico), todos em dependências que já existiam | `package-lock.json` | 🟠 | A.3 |
| `npm run lint` falha com 2 erros que já existiam (`react-hooks/set-state-in-effect` em `components/ui/carousel.tsx` e `hooks/use-mobile.ts`) e 2 avisos de variável sem uso (`actions.ts:10`, `right-sidebar.tsx:556`). O ESLint também varre `.agents/` | lint | 🟡 | A.3 (bloqueia o CI) |
| Uma aresta apontando para um nó inexistente passa no `validateGraph`, mas a run quebra no `toposort.array` com "Unknown node", antes de publicar qualquer step. Pode acontecer com edição concorrente no canvas | `validate-graph.ts`, `run-workflow.ts:76` | 🟠 | B.1 |
| Um Start desconectado passa na validação: a run executa qualquer nó ligado a uma aresta, alcançável ou não a partir do Start | `validate-graph.ts`, `run-workflow.ts:75` | 🟡 | B.1 |
| `interpolate` não codifica valores usados dentro de uma URL: `a b&page=2` vira um parâmetro extra | `interpolate.ts` | 🟡 | Backlog |
