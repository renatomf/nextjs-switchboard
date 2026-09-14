# ADR 0002 — Versões imutáveis de workflow

- **Status:** aceito
- **Data:** 2026-09-14
- **Onde:** `lib/db/schema.ts` (`workflow_versions`), `features/workflows/data.ts`,
  `features/workflows/tasks/load-run-graph.ts`, `features/workflows/actions.ts`

## Contexto

O canvas vive numa sala do Liveblocks: é o rascunho, editado ao mesmo tempo por todo mundo da
organização. Até aqui, o Run fazia duas coisas:

1. sobrescrevia `workflows.graph` com o grafo em mãos;
2. disparava a task do Trigger.dev passando só o `workflowId`.

O worker lia o grafo **quando chegava na run**, o que pode ser segundos ou minutos depois, se houver
fila. Daí dois problemas:

- **Race condition:** a pessoa A clica em Run e a run entra na fila; a pessoa B, no mesmo canvas,
  muda o grafo e clica em Run. A run da A executa o grafo da B.
- **Histórico perdido:** como o grafo era sobrescrito, não havia como saber o que uma run antiga
  executou.

Um terceiro fato pesou na decisão: **o app web (Vercel) e o worker (Trigger.dev) são publicados
separadamente.** Durante uma transição, um lado pode estar na versão nova e o outro na antiga.

## Decisão

- **Cada Run publica uma versão imutável** do grafo na tabela `workflow_versions`, numa transação
  que também atualiza `workflows.graph` como o retrato mais recente. A run recebe o `versionId`.
- **A task executa exatamente aquela versão.** Se a versão não existir, a run falha. Ela nunca cai
  para o grafo mais recente, porque isso reabriria a race sem ninguém perceber.
- **O payload mantém o `workflowId` e acrescenta o `versionId` opcional.** Um worker novo que
  receber uma run disparada por um app antigo, sem `versionId`, lê o grafo mais recente, como antes.
  Assim os dois lados podem ser publicados em qualquer ordem.
- **A validação ficou mais rígida antes de publicar** (aresta órfã, passo que o Start não alcança),
  porque agora o grafo salvo é permanente.
- **Rascunho e versão têm papéis separados:** o Liveblocks é onde se edita, e a versão é o que foi
  executado.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Mandar o grafo inteiro no payload da task | Payload grande (prompts longos em vários nós) sujeito aos limites do Trigger.dev, sem histórico consultável no banco e sem vínculo com a org |
| Travar o workflow enquanto houver uma run na fila | Obriga as pessoas no mesmo canvas a esperar umas pelas outras, exige liberar a trava em toda falha e não resolve o histórico |
| Guardar um checksum e conferir no worker | Detecta que o grafo mudou, mas não recupera o original: a run falharia em vez de executar o que foi pedido |
| Remover `workflows.graph` agora | Ainda é lido pela trava de plano (como fallback) e pelas runs sem `versionId`. Sai quando não houver mais leitores |

## Consequências

- ✅ Cada run executa o grafo com que foi iniciada. A race está fechada, com teste provando que dois
  Runs seguidos levam versões diferentes.
- ✅ Existe histórico de versões por workflow, a base da tabela `executions` da B.2.
- ✅ O app e o worker podem ser publicados em qualquer ordem.
- ⚠️ A tabela ganha uma linha por Run, com o grafo inteiro em `jsonb`. Ainda não há política de
  retenção; é candidata a limpeza na Fase E.
- ⚠️ `workflows.graph` fica redundante com a última versão, mantido por compatibilidade.
- ⚠️ O ramo de compatibilidade do `loadRunGraph` (run sem `versionId`) pode sair assim que nenhuma
  run antiga estiver mais na fila.
- ⚠️ **A migration `0003` precisa estar aplicada antes de o app novo ir para o ar**, senão o Run
  falha: a tabela ainda não existiria.
