# ADR 0008 — Workflows agendados

- **Status:** aceito
- **Data:** 2026-09-15
- **Onde:** `features/workflows/lib/schedule-presets.ts`, `features/workflows/start-run.ts`,
  `features/workflows/actions.ts`, `features/workflows/tasks/scheduled-run.ts`,
  `features/workflows/tasks/run-scheduled-workflow.ts`, `lib/org-plan.ts`,
  `lib/db/schema.ts` (`workflow_schedules`), `features/workflows/components/schedule-panel.tsx`

## Contexto

Um workflow precisa poder rodar sozinho, num horário, sem alguém apertar Run. O Trigger.dev tem dois
tipos de agendamento: o declarado no código (um cron fixo na task) e o criado pelo SDK, com um
`externalId` e uma chave de deduplicação.

O que restringe o desenho:

- **O plano Free do Trigger.dev permite 10 agendamentos por projeto,** somando todos os ambientes.
- **A chave de deduplicação vale para o projeto inteiro, não por ambiente.** Desenvolvimento e
  produção dividem o banco, então o mesmo workflow existe nos dois.
- **A run agendada não tem sessão do Clerk,** então não dá para perguntar o plano com `has()`.
- **Cada run custa uma sessão da Browserbase e chamadas ao modelo,** e ninguém está olhando.

## Decisão

- **Presets em vez de cron livre:** a cada hora, todo dia ou toda semana, num horário e num fuso. O
  código gera o cron. Nenhum preset roda mais de uma vez por hora, e não há sintaxe de cron para
  validar.
- **Só para o plano Pro,** com um teto de 2 agendamentos por organização em cada ambiente. Um
  workflow já agendado sempre pode mudar o próprio agendamento. O teto é uma constante
  (`MAX_SCHEDULES_PER_ORG`).
- **Um agendamento criado pelo SDK por workflow e ambiente,** todos presos a uma única task,
  `run-scheduled-workflow`, que não tem cron próprio.
  - A chave de deduplicação é `ambiente:workflow:id`. O ambiente sai do prefixo da chave secreta
    (`tr_dev_`, `tr_prod_`), sem configuração nova.
  - A task acha o agendamento pelo `scheduleId` que o Trigger.dev entrega no disparo.
- **Uma tabela `workflow_schedules`** guarda o que o app sabe de cada agendamento: workflow,
  organização, ambiente, preset, fuso, o id no Trigger.dev e se está ativo.
- **A run agendada passa pelo mesmo caminho do botão Run** (`startWorkflowRun`): a trava de uma run
  por workflow, a fila do plano e o registro da execução. Ela sai com a tag `scheduled`.
- **O plano é conferido a cada disparo,** na API de backend do Clerk, com `fetch` direto e sem o SDK
  do Clerk no worker.
  - Organização fora do Pro: o agendamento é desligado no Trigger.dev e no banco, e religado quando
    ela salvar de novo.
  - Só uma resposta clara decide. Uma falha do Clerk, ou uma resposta que não parece uma assinatura,
    faz a run falhar sem desligar nada.
- **Salvar publica o canvas como versão,** para a primeira run agendada rodar o que estava na tela.
  Depois disso, cada run agendada usa a versão mais nova, inclusive as publicadas pelo Run.
- **As recusas que o usuário consegue resolver voltam como resultado,** não como erro: plano, preset
  e teto. Em produção, a mensagem de um erro lançado por uma Server Action não chega ao navegador.
- **Um agendamento sem registro no banco,** que sobra quando o salvamento falha no meio, é apagado
  pela própria task no primeiro disparo.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Cron livre | Exige validar a expressão e calcular o intervalo mínimo, e um `* * * * *` digitado por engano abre uma sessão por minuto |
| Uma task que acorda a cada minuto e procura workflows vencidos | Roda o tempo todo sem necessidade, e a precisão depende da varredura |
| Guardar o plano no momento de salvar | Fica velho: uma organização que cancelou continuaria rodando |
| `@clerk/backend` no worker | Uma dependência nova por uma chamada, e a API de cobrança é experimental de qualquer jeito |
| Chave de deduplicação só com o id do workflow | O mesmo workflow em desenvolvimento e produção: um ambiente tomaria o agendamento do outro |

## Consequências

- ✅ Um workflow roda sozinho, com as mesmas garantias de uma run manual: uma por vez, fila do plano e
  registro da execução.
- ✅ Uma organização que sai do Pro para de gastar com agendamentos no disparo seguinte, sem job extra.
- ⚠️ **O teto é baixo** por causa do plano Free do Trigger.dev. Mudar o plano é trocar uma constante.
- ⚠️ **A checagem depende de uma API experimental do Clerk.** Se ela mudar de formato, as runs
  agendadas passam a falhar (visíveis no Sentry), mas nenhum agendamento é desligado.
- ⚠️ **Precisa da `CLERK_SECRET_KEY` no ambiente do worker,** além das variáveis que ele já usa.
- ⚠️ **A ordem de deploy importa:** a migration `0005` antes de tudo, porque a página do workflow lê
  a tabela nova; depois o worker, com a task nova; e só então o app.
