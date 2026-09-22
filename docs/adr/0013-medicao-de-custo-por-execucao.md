# ADR 0013 — Medição de custo por execução

- **Status:** aceito
- **Data:** 2026-09-22
- **Onde:** `lib/db/schema.ts`, `features/workflows/data.ts`,
  `features/workflows/lib/session-duration.ts`,
  `features/workflows/tasks/execution-tracking.ts`,
  `features/workflows/tasks/session-cost-collector.ts`,
  `features/workflows/tasks/browser-session.ts`

## Contexto

O relatório semanal ([`run-metrics.ts`](../../features/workflows/lib/run-metrics.ts)) sabe quantas
runs deram certo e quanto tempo levaram, mas não sabe quanto custaram. Uma run gasta em duas frentes:
o tempo que a Browserbase manteve o navegador aberto e os tokens que o modelo consumiu. Nenhum dos
dois chegava ao banco.

Custo tem uma propriedade que as outras métricas não têm: **não se apura depois**. Uma meta de SLO
pode esperar por dados reais, porque quando eles chegarem as métricas já os terão gravado. Cada run
que roda sem instrumentação é um custo perdido para sempre.

Os dois números existem, mas não no mesmo lugar nem no mesmo momento:

- os tokens vivem na instância do Stagehand (`stagehand.metrics`), e fechá-la os leva junto;
- a duração só existe depois que a sessão fecha — e quem fecha é a própria run, na saída.

## Decisão

**Gravar quantidades, não dinheiro.** As colunas guardam tokens e segundos. Preço de token e de
browser-minuto muda; um valor em dinheiro gravado congela um número que não dá para recalcular a
partir da linha. Converter para custo é trabalho de uma lib pura, com as tarifas como parâmetro.

**Coletar em dois momentos, por um motivo em cada.** Os tokens são lidos pela própria run, num
gancho `beforeClose` da sessão do navegador — é o último instante em que existem. A duração é
coletada depois, pela varredura que já roda a cada 15 minutos, porque perguntar dentro da run
disputaria com o fechamento que ela acabou de pedir.

**A duração vem da sessão, não do relógio do worker.** O worker sabe quando abriu e quando mandou
fechar, e isso seria mais barato. Mas o projeto já registra que uma sessão pode sobreviver ao
worker: ela volta com `keepAlive=true` e, se o processo morre sem cancelar, fica aberta — e cobrando
— até o timeout de 5 minutos da Browserbase. O relógio local para no crash; a cobrança não. Medir
localmente subestimaria exatamente os casos mais caros.

**A contabilidade nunca derruba uma run.** O `beforeClose` tem tempo limite próprio e engole a
própria falha, pela mesma razão que o `closeQuietly` existe: ele roda no `finally` da run, onde um
erro substituiria o erro que a run de fato teve. Uma sessão cobrando não pode ficar aberta esperando
uma leitura de métrica. O que a falha não faz é passar em silêncio — ela vira evento no Sentry,
porque um número que para de chegar some de todo relatório seguinte sem avisar.

## Alternativas consideradas

**Cronometrar a sessão no worker.** Descartada pelo motivo acima: erra para menos justamente na
sessão órfã, que é a que mais custa.

**Gravar o custo em dinheiro na linha.** Descartada: amarra a linha à tabela de preços vigente no
dia, e uma mudança de preço tornaria todo o histórico incomparável sem dar como recalcular.

**Uma tabela nova para custo.** Descartada: é um-para-um com a execução. Mesmo critério que adiou a
tabela de passos — ela entra quando alguém precisar lê-la separada.

**Uma task agendada só para custo.** Descartada: ela quereria exatamente o que a varredura da C.5 já
quer, olhar runs que acabaram pouco tempo atrás. Duas tarefas na mesma varredura, com a
reconciliação primeiro, fazem a run que a varredura acabou de fechar já ficar elegível ao custo na
mesma passada.

**Gravar `proxyBytes` junto.** Descartada por ora: o projeto não configura proxy, então a coluna
seria zero em toda linha. Entra quando houver proxy para medir.

## Consequências

As cinco colunas são todas anuláveis, e nulo quer dizer coisas diferentes conforme a coluna: uma run
que nunca chamou modelo fica sem tokens para sempre, e uma sessão que a Browserbase ainda não fechou
fica sem segundos até a varredura seguinte. Quem for somar custo precisa tratar nulo como "não
sabemos", e não como zero.

O custo de uma run só fica completo alguns minutos depois de ela terminar. Nada na tela promete o
contrário hoje, mas um painel que mostre custo precisa saber disso.

Converter essas quantidades em dinheiro, e levá-las ao relatório semanal, fica para o passo seguinte
— deliberadamente depois, para que as tarifas sejam conferidas contra dados reais já gravados em vez
de contra uma planilha de preços.
