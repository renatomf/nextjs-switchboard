# ADR 0009 — Trigger por webhook

- **Status:** aceito
- **Data:** 2026-09-15
- **Onde:** `app/api/webhooks/workflows/[id]/route.ts`,
  `features/workflows/lib/webhook-signature.ts`,
  `features/workflows/lib/webhook-rate-limit.ts`, `features/workflows/actions.ts`,
  `features/workflows/start-run.ts`, `lib/db/schema.ts` (`workflow_webhooks`, `webhook_calls`),
  `features/workflows/components/webhook-panel.tsx`

## Contexto

Um workflow precisa poder ser iniciado por outro sistema: um pedido pago, um formulário enviado, um
alerta. Isso é uma porta aberta na internet, e ela tem três problemas que o botão Run e o
agendamento não têm.

- **Não existe sessão.** Quem chama não é uma pessoa logada, então o Clerk não responde quem é.
- **O mesmo evento chega mais de uma vez.** Todo sistema que envia webhook repete a entrega quando
  não recebe resposta a tempo.
- **Cada chamada custa dinheiro.** Uma run abre uma sessão de navegador e chama o modelo, então um
  remetente em laço vira conta.

## Decisão

- **Um segredo por workflow** (`workflow_webhooks`), criado pela organização dona e mostrado ao
  navegador **uma vez**. Depois disso ele só volta como assinatura para conferir.
- **Assinatura no formato que Stripe e GitHub usam:** `t=<unix>,v1=<hmac sha256 de "t.corpo">`, no
  cabeçalho `x-switchboard-signature`.
  - O timestamp é assinado junto com o corpo, então um pedido capturado não pode ser reenviado depois
    com a assinatura dele.
  - A janela é de 5 minutos, para os dois lados, porque um relógio muito adiantado é tão suspeito
    quanto um muito atrasado.
  - A comparação é em tempo constante, senão o tempo de resposta entregaria o digest aos poucos.
- **A ordem das checagens na rota é parte do desenho:**
  1. procurar o webhook. Um workflow sem webhook e um workflow que não existe respondem o mesmo 404,
     para não revelar quais ids são reais;
  2. conferir a assinatura;
  3. só então contar a chamada no limite de frequência. Contar antes deixaria qualquer um sem segredo
     encher o contador e travar o remetente legítimo;
  4. conferir o plano da organização no Clerk;
  5. pegar a versão mais nova e iniciar a run.
- **Limite de 10 chamadas por minuto, por workflow,** contado em janelas fixas numa linha do Postgres
  por workflow e janela (`webhook_calls`), incrementada pela própria chamada. Em memória seria errado:
  com duas instâncias do app, cada uma contaria metade.
- **O `Idempotency-Key` do chamador vira a chave de idempotência do disparo,** prefixada com o
  workflow. O mesmo evento entregue duas vezes é uma run só.
- **A run passa pelo mesmo `startWorkflowRun`** do botão Run e do agendamento, com a tag `webhook`.
- **Só no plano Pro,** conferido a cada chamada na API de backend do Clerk, como faz a task agendada.
  Clerk fora do ar responde 503 e não inicia nada.
- **Remover o webhook não depende do plano:** fechar uma porta aberta nunca pode depender de assinatura.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Uma URL secreta, sem assinatura | Vaza em log de proxy, histórico e print, e não dá para saber se o corpo foi alterado no caminho |
| Guardar só o hash do segredo, como se fosse senha | Conferir uma assinatura HMAC exige o segredo de volta; hash impede a verificação |
| Contar o limite em memória | Com duas instâncias, cada uma libera o limite inteiro, e um deploy zera a contagem |
| Deduplicar o evento numa tabela própria | O Trigger.dev já deduplica por chave no disparo; uma tabela a mais seria outro estado para manter |
| Contar a chamada antes de conferir a assinatura | Quem não tem o segredo encheria o contador e derrubaria o remetente legítimo |

## Consequências

- ✅ Um sistema externo inicia um workflow com as mesmas garantias de uma run manual: uma por vez,
  fila do plano e registro da execução.
- ✅ Entrega repetida do mesmo evento não vira duas runs, desde que o remetente envie
  `Idempotency-Key`.
- ⚠️ **O segredo fica em claro no banco,** porque a verificação precisa dele. O cofre de credenciais,
  também da fase D, é o passo que criptografa colunas assim.
- ⚠️ **Sem `Idempotency-Key`, cada entrega é um evento novo.** A trava de uma run por workflow limita o
  estrago, mas não substitui a chave.
- ⚠️ **A tabela `webhook_calls` só cresce.** Cada janela deixa uma linha por workflow; uma limpeza das
  janelas velhas fica para a varredura da C.5.
- ⚠️ **Mais uma chamada ao Clerk no caminho quente,** para conferir o plano a cada requisição.
