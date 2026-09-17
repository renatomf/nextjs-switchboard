# ADR 0010 — Cotas de run por organização

- **Status:** aceito
- **Data:** 2026-09-16
- **Onde:** `features/workflows/lib/run-quota.ts`, `features/workflows/start-run.ts`,
  `features/workflows/data.ts` (`countOrgRunsSince`), `features/workflows/actions.ts`,
  `app/api/webhooks/workflows/[id]/route.ts`, `features/workflows/tasks/scheduled-run.ts`,
  `app/(dashboard)/workflows/[id]/page.tsx`, `features/workflows/components/right-sidebar.tsx`,
  `lib/db/schema.ts` (índice `executions_org_id_created_at_idx`)

## Contexto

Toda run abre uma sessão de navegador na Browserbase e chama um modelo. O custo é por run, não por
usuário, e até aqui nada limitava quantas runs uma organização inicia.

A fila por organização ([ADR 0006](0006-concorrencia-por-org.md)) limita quantas runs correm **ao
mesmo tempo**, que é outra pergunta: uma run por vez, durante trinta dias, ainda são milhares de
runs. E o número de portas que iniciam uma run cresceu — o botão Run, o agendamento
([ADR 0008](0008-workflows-agendados.md)) e o webhook ([ADR 0009](0009-trigger-por-webhook.md)).
As duas últimas rodam sem ninguém olhando: um agendamento de hora em hora são cerca de 720 runs por
mês sem um clique sequer.

## Decisão

- **20 runs por mês no plano free, 500 no Pro.** Números provisórios, num lugar só (`RUN_QUOTAS`),
  porque são decisão de produto e vão mudar.
- **Mês civil em UTC.** O mês de todo mundo vira no mesmo instante, em vez de cada organização
  contar a partir de quando assinou.
- **A contagem é de linhas da tabela `executions` criadas desde o começo do mês.** Não existe
  contador separado para manter sincronizado.
- **Contada dentro da trava de run do workflow** (a mesma da checagem de "já tem uma run rodando"),
  **e antes de publicar a versão**: dois inícios que chegam juntos não podem ver os dois a última
  vaga do mês, e um início que vai ser recusado não deve deixar uma versão para trás.
- **`usadas >= limite` recusa.** Com cota de 20, a vigésima run acontece e a vigésima primeira é
  recusada. A regra mora em `isUsageOverQuota`, que tanto o servidor quanto a interface consultam.
- **Cada porta recusa na sua língua:**

| Porta | O que acontece ao acabar a cota |
| --- | --- |
| Botão Run | Resultado com os números (`usadas de limite`), não exceção: em produção a mensagem de um erro lançado não chega ao navegador |
| Webhook | `429` com `Retry-After` igual ao que falta para o mês virar, porque quem chama é um sistema e vai tentar de novo |
| Agendamento | Continua **ligado** e a run não acontece. Diferente de uma organização que saiu do Pro, a cota volta sozinha no mês seguinte; desligar exigiria alguém perceber e religar |

- **Uma run devolvida não custa cota,** porque nada é iniciado: nem a que já estava rodando (a trava
  devolve a mesma), nem a que uma chave de idempotência recuperou.
- **Índice `(org_id, created_at)` na `executions`** (migração 0008): a contagem acontece no caminho
  quente, dentro da trava.
- **A interface mostra `usadas / limite runs this month`** embaixo do botão Run, em vermelho quando
  não há mais vaga.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Um contador por organização, incrementado a cada run | Dessincroniza do que de fato aconteceu — uma run gravada sem o contador subir, ou o contrário, e não há como saber qual dos dois está certo. Contar linhas sempre responde o que existe |
| Medir pelo metering do Clerk Billing | Põe um serviço externo no caminho quente de toda run. O Clerk responde qual é o plano, que é a pergunta que ele sabe responder melhor que nós |
| Contar quando a run termina | A recusa precisa vir antes de gastar. Uma run em andamento já abriu a sessão do navegador e já chamou o modelo |
| Cota por dia | Um dia de trabalho de verdade tem pico: quem constrói um workflow roda dez vezes seguidas. O mês absorve o pico, o dia transforma uso normal em bloqueio |
| Recusar só no botão Run | As portas que mais gastam são justamente as automáticas, que rodam sem ninguém olhando |
| Mês contado a partir da data de assinatura de cada organização | Exige guardar e conferir essa data; o mês civil é o mesmo para todos e é o que aparece numa fatura |

## Consequências

- ✅ **Teto previsível de custo por organização,** e o mesmo teto nas três portas, porque todas
  passam pelo mesmo `startWorkflowRun`.
- ✅ **Nada de contador para manter:** a fonte é o registro de execuções, que já existia
  ([ADR 0003](0003-registro-de-execucoes.md)).
- ⚠️ **O banco é dividido entre desenvolvimento e produção,** então uma run de desenvolvimento
  consome a cota da mesma organização em produção — a mesma ressalva da varredura da C.5.
- ⚠️ **Uma run que falha ou é cancelada conta,** porque já custou sessão e modelo. Só não conta a que
  nunca chegou a iniciar.
- ⚠️ **O número na tela é do instante em que a página renderizou** e só se move ao recarregar. A
  recusa é sempre do servidor, dentro da trava, então um número velho na tela não deixa passar run
  nenhuma — ele só fica desatualizado.
- ⚠️ **Mais uma consulta ao banco em todo início de run,** dentro da trava. O índice é o que a mantém
  barata, e a migração 0008 precisa estar aplicada antes do deploy.
- ⚠️ **Nada avisa a organização quando ela está chegando perto:** a linha na sidebar só muda de cor
  quando a cota já acabou. Um aviso em 80% seria o próximo passo.
- ⚠️ **Nada é reportado ao Clerk Billing.** O plano vem do Clerk, a contagem é nossa. Cobrar por uso
  acima da cota, em vez de recusar, seria outra decisão.
