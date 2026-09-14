# ADR 0004 — Motor de execução separado da task

- **Status:** aceito
- **Data:** 2026-09-14
- **Onde:** `features/workflows/engine/run-steps.ts`, `features/workflows/tasks/run-workflow.ts`,
  `features/workflows/tasks/browser-session.ts`

## Contexto

A lógica de uma run vivia inteira dentro do `run` da task do Trigger.dev:

- a ordem dos passos e a passagem pelo Start;
- a interpolação entre passos;
- as transições da máquina de estados dos passos;
- o limite de tamanho das saídas;
- o que uma falha e um Stop fazem com o passo em andamento.

Tudo isso estava preso ao `metadata` e ao `logger` do Trigger.dev e ao Stagehand, e nenhuma linha
tinha teste. O Stop exatamente entre dois passos, por exemplo, só podia ser verificado lendo o
código: acertar esse intervalo clicando é quase impossível.

## Decisão

- **`runSteps` recebe o grafo, os executores dos nós e quatro dependências:**
  - o navegador (`get` e `release`);
  - o repórter de progresso (`publish`, `flush` e `flushReliably`);
  - um logger;
  - o sinal de cancelamento.

  Ele devolve os passos e as saídas.
- **A task só monta as peças:** carrega o grafo, cria a sessão da Browserbase com
  `createBrowserSession`, adapta o `metadata` ao repórter e chama o `runSteps`. A conversão para
  JSON e as três tentativas de envio ficam no adaptador, porque são exigências do `metadata`, e não
  do motor.
- **Só duas interfaces novas, navegador e progresso,** cada uma com o formato mínimo que o motor já
  usava. Os executores continuam recebendo o Stagehand.
- **14 testes fixam o comportamento com dublês,** inclusive a falha, o Stop no meio de um passo e o
  Stop entre dois passos.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Testar a task com o SDK do Trigger.dev e o Stagehand simulados por `vi.mock` | Testa os mocks, e não o comportamento, e quebra a cada mudança na API dos SDKs |
| Um motor genérico sobre o tipo do navegador, com executores independentes do Stagehand | Nenhum problema de hoje pede isso. Os executores são o adaptador do Stagehand, e mudam junto com ele na B.5 |
| Um repórter com um único `flush` | O envio antes de a run lançar o erro precisa de novas tentativas. Aplicá-las a todo passo somaria 600 ms ao início de cada um |

## Consequências

- ✅ O comportamento de uma run tem teste, sem subir o Trigger.dev nem abrir um navegador.
- ✅ A migração para o Stagehand 4 (B.5) mexe nos executores e na abertura da sessão, sem tocar no
  motor.
- ✅ A interface deixa de importar tipos de dentro do arquivo da task: o `RunStep` mora no motor.
- ⚠️ A task em si continua sem teste unitário: os hooks, a abertura da sessão e o adaptador do
  `metadata`. Ela é coberta pelo teste de ponta a ponta.
