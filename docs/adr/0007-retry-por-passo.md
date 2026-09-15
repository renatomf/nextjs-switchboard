# ADR 0007 — Novas tentativas e tempo limite por passo, dentro da run

- **Status:** aceito
- **Data:** 2026-09-15
- **Onde:** `features/workflows/engine/run-steps.ts`, `features/workflows/lib/step-errors.ts`,
  `features/workflows/nodes/step-policies.ts`, `features/workflows/nodes/send-email.ts`

## Contexto

A task roda com uma tentativa só (`retry: { maxAttempts: 1 }`). Repetir a task refaz o grafo
inteiro numa sessão nova da Browserbase, pagando de novo cada passo e cada chamada ao modelo. Isso
deixava dois problemas:

- **Falha passageira derrubava a run inteira:** uma conexão que caiu, um 503 da API do Stagehand ou
  um modelo sobrecarregado encerravam a run, mesmo quando a mesma chamada, segundos depois, passaria.
- **Nenhum passo tinha tempo limite:** o Agent com um modelo sobrecarregado segurou o passo por
  209 s, perto do limite da sessão.

O que torna o problema difícil:

- **Os erros não dizem de forma uniforme se vale tentar de novo.** O AI SDK marca `isRetryable` e
  `statusCode` no erro, mas o cliente da API do Stagehand só põe o status no texto da mensagem
  (`HTTP error! status: 503`, `Unknown error: 402`).
- **Um passo em andamento não pode ser interrompido.** Os executores não recebem um sinal, e o
  Stagehand continua trabalhando depois que o motor desiste de esperar por ele.
- **Depois de uma falha, não dá para saber até onde a tentativa foi.** Um Act pode ter clicado
  antes de a resposta se perder.

## Decisão

- **A nova tentativa é por passo, dentro da run e na mesma sessão.** O passo repete onde está, na
  página que os passos anteriores deixaram. A task continua com uma tentativa.
- **Só erros conhecidos como passageiros ganham nova tentativa** (`isRetryableStepError`). A ordem:
  - o que o próprio erro diz (`isRetryable`);
  - o status da resposta: 408, 429, 5xx e 529;
  - o código da conexão (`ECONNRESET`, `ETIMEDOUT`…);
  - mensagens conhecidas (modelo sobrecarregado, `fetch failed`);
  - a cadeia de `cause`.

  Um erro desconhecido não repete: a nova tentativa custa as mesmas chamadas ao modelo que a que
  falhou.
- **Cada tipo de nó tem uma política** em `step-policies.ts`: o tempo de cada tentativa, o número
  de tentativas e a espera entre elas. O `satisfies` torna uma política faltando um erro de
  compilação, como já acontece com os executores.
- **Só repete o nó que pode fazer o trabalho duas vezes sem efeito colateral:**
  - Open URL, Extract e Observe (2 tentativas) só leem a página.
  - Send Email (3 tentativas) envia com `idempotencyKey` = `runId:nodeId`. A chave é a mesma em
    todas as tentativas, e a Resend devolve o primeiro e-mail em vez de mandar outro.
  - Act e Agent têm uma tentativa. Os dois mudam a página, e depois de uma falha não dá para saber se
    a ação já aconteceu.
- **Um passo que estoura o tempo falha sem nova tentativa** (`StepTimeoutError`). A tentativa não
  pode ser interrompida e pode continuar mexendo na página, então uma segunda tentativa no mesmo
  navegador disputaria a página com ela. A run termina, e liberar o navegador é o que para a
  tentativa que ficou rodando.
- **O passo continua `running` durante as novas tentativas.** O evento `retried` da máquina de
  estados grava a tentativa em `attempts`, e o canvas mostra isso. Um Stop durante a espera entre
  tentativas termina o passo na hora, como cancelado.
- **Sem `AbortTaskRunError`.** Ele só impede novas tentativas da task, e a task tem uma tentativa só.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Deixar o Trigger.dev repetir a task inteira (padrão de 3 tentativas) | Refaz todos os passos numa sessão nova: paga de novo cada chamada ao modelo, e repete e-mails e cliques que já tinham acontecido |
| `retry.onThrow` do SDK do Trigger.dev dentro de cada executor | Prende o motor ao Trigger.dev, que hoje ele não conhece, e os testes passam a depender do SDK |
| Repetir qualquer erro | Uma instrução ruim, uma chave inválida ou uma cota esgotada falham do mesmo jeito na segunda vez, e custam as mesmas chamadas ao modelo |
| Repetir também o Act | Um Act que falhou pode já ter clicado. Repetir poderia clicar ou enviar duas vezes |

## Consequências

- ✅ Uma conexão que caiu ou um 503 passageiro não derrubam mais a run, e a nova tentativa custa um
  passo, não o grafo inteiro.
- ✅ Nenhum passo segura a run além do tempo da sua política.
- ✅ Repetir um Send Email não manda o e-mail duas vezes.
- ⚠️ **Um passo que estoura o tempo encerra a run** em vez de ser repetido, porque a tentativa não
  pode ser interrompida.
- ⚠️ **Act e Agent não repetem.** Uma falha passageira neles ainda derruba a run.
- ⚠️ **A classificação depende do texto de erros de terceiros** (o status na mensagem do Stagehand,
  "high demand"). Se o texto mudar, o erro vira desconhecido e deixa de ser repetido, que é o lado
  seguro.
- ⚠️ **Os limites valem por passo, não para a run.** A soma dos passos ainda precisa caber na sessão
  da Browserbase.
