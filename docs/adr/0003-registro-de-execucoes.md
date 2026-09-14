# ADR 0003 — Registro de execuções

- **Status:** aceito
- **Data:** 2026-09-14
- **Onde:** `lib/db/schema.ts` (`executions`), `features/workflows/lib/execution-status.ts`,
  `features/workflows/data.ts`, `features/workflows/tasks/execution-tracking.ts`,
  `features/workflows/tasks/run-workflow.ts`, `features/workflows/actions.ts`,
  `app/api/replays/[sessionId]/route.ts`

## Contexto

Até aqui, o histórico de runs só existia no Trigger.dev, que o mantém por tempo limitado. Nada no
nosso banco ligava uma run, ou a sessão de navegador que ela abriu, a uma organização. Por isso a
rota de replay servia a gravação de qualquer sessão para qualquer pessoa logada (IDOR).

A documentação dos hooks de ciclo de vida do Trigger.dev (SDK 4.5.16) mostrou os limites que
moldaram o desenho:

- `onCancel` **só roda se a run estiver executando**. Uma run cancelada na fila nunca chama o hook;
- `onFailure` **não roda** para runs que travam, falhas de sistema e cancelamentos;
- erros lançados em `onSuccess`, `onFailure` e `onComplete` são **ignorados**, e um erro no
  `onStartAttempt` **derruba a tentativa**.

Além disso, o app e o worker gravam de lados diferentes, e **o worker pode começar a run antes de
o app terminar de gravar**.

## Decisão

- **Uma tabela `executions`**, com uma linha por run e `run_id` único.
- **A linha nasce no app**, como `queued`, logo depois do trigger. **O worker a avança** pelos hooks
  (`running`, depois `succeeded` ou `failed`). **A action do Stop grava `cancelled`** por conta
  própria, cobrindo a run parada ainda na fila.
- **Os dois lados usam `INSERT … ON CONFLICT (run_id)`.** Quem chegar primeiro cria a linha.
- **As transições são protegidas pela máquina de estados** (`execution-status.ts`, em TDD) e
  aplicadas **dentro do próprio `UPSERT`** (`setWhere`). A checagem e a gravação são um único
  comando, sem leitura intermediária, e os estados finais nunca mudam. Um teste garante que a
  guarda do SQL e a regra em TypeScript concordam em todas as combinações.
- **Os hooks nunca lançam erro.** Uma gravação que falha vai para o Sentry. O Run e o Stop também
  não falham por causa de uma gravação de controle.
- **A sessão da Browserbase é gravada na execução** assim que o navegador abre. **A rota de replay
  só serve sessões de runs da organização de quem pede**; "não é seu" e "não existe" respondem o
  mesmo 404.
- **Todas as colunas de data passaram a `timestamptz`**, com a conversão dos valores antigos feita
  explicitamente em UTC.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Só os hooks do worker gravando | Deixa três buracos: cancelamento na fila, runs que travam e gravações que falham em silêncio |
| Consultar a API do Trigger.dev na hora, sem tabela | Não liga a sessão do navegador a uma org, depende da retenção do Trigger, custa uma chamada externa por pedido e esbarra em rate limit |
| Ler o status, decidir e depois gravar, numa transação | Mais idas ao banco e um intervalo em que outro processo pode gravar. A guarda no próprio `UPDATE` é atômica e suficiente |
| Tipo `enum` do Postgres para o status | Difícil de alterar depois. Um `CHECK` gerado da mesma lista da máquina de estados dá a mesma garantia |

## Consequências

- ✅ O IDOR do replay está fechado, com teste de regressão que falhava na versão anterior.
- ✅ Há um histórico durável de execuções, a base para métricas, quotas por organização e custo.
- ⚠️ **Uma run que trava sem hook nenhum fica como `running`.** A solução completa é uma
  reconciliação com a API do Trigger.dev (uma task agendada, por exemplo), registrada no roadmap.
- ⚠️ **Replays de runs anteriores a esta tabela passam a responder 404**, porque não existe registro
  de quem é o dono delas.
- ⚠️ A tabela ganha uma linha por run e ainda não tem política de retenção.
