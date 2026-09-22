# Postmortem — as atualizações de etapa que sumiam a caminho do canvas

- **Quando:** 6 de setembro de 2026, durante a implementação do status ao vivo
- **Onde:** `features/workflows/engine/run-steps.ts`, `features/workflows/tasks/run-workflow.ts`
- **Commit da correção:** `a89728d`

## Resumo

O canvas mostra cada etapa de uma run mudando de estado em tempo real. Dois defeitos
independentes, ambos **silenciosos por desenho**, faziam essas atualizações desaparecerem entre o
worker e a tela. Nenhum dos dois lançava erro: em ambos, a biblioteca fazia exatamente o que
prometia, e era a nossa leitura do contrato que estava errada.

## Impacto

Para quem usa: a run acontecia, mas a tela mentia. No primeiro defeito, o canvas congelava no
primeiro estado — todos os passos "pendentes" para sempre, enquanto a run terminava normalmente. No
segundo, um passo que falhava ficava eternamente "executando".

Nenhum dado foi perdido e nenhuma run foi afetada. O estrago era de confiança: a interface deixava
de refletir a realidade, e não havia como saber disso olhando para ela.

## O que aconteceu

### Primeiro modo: o descarte por igualdade profunda

O `metadata.set` do Trigger.dev **guarda a referência que recebe**. Na chamada seguinte, se o valor
novo for profundamente igual ao que ele já tem, ele **não faz nada** — é uma otimização razoável,
que evita tráfego para um valor que não mudou.

A armadilha aparece quando as duas coisas se juntam. Alterar o array de etapas **no lugar** alteraria
também a cópia que o store guarda, porque é o mesmo objeto. Os dois lados sempre bateriam. E então:

```
publish(steps)        → guarda a referência
steps[0].status = ... → altera a cópia guardada junto
publish(steps)        → "nada mudou", descartado
```

Toda atualização depois da primeira sumia em silêncio.

### Segundo modo: o flush que não acontece

O `metadata.flush()` **volta sem fazer nada se já houver um flush em andamento** — e um roda num
temporizador de fundo, a cada segundo aproximadamente.

Na maior parte do tempo isso é inofensivo: o próximo ciclo leva o valor. Mas **no caminho de erro a
run estoura logo em seguida**, e não existe próximo ciclo. O estado final do passo que falhou nunca
saía do worker.

## Por que foi difícil de ver

Os dois defeitos compartilham a mesma propriedade, e é ela que os torna caros: **o comportamento
correto da biblioteca e o nosso bug são indistinguíveis de fora**. Um `set` que não faz nada porque o
valor não mudou e um `set` que não faz nada porque nós corrompemos a comparação produzem exatamente
o mesmo silêncio.

Não havia exceção, log, nem status de erro. O sintoma era ausência — e ausência não aparece em
nenhuma busca.

## A correção

Três mudanças, cada uma atacando um elo:

1. **O array de etapas é refeito a cada mudança, nunca alterado no lugar.** Isso quebra a identidade
   entre o que publicamos e o que o store guarda, e é a correção de fato — as outras duas são defesa
   em profundidade.
2. **A cópia publicada passa por JSON.** `JSON.parse(JSON.stringify(steps))` desanexa o que vai para
   o store do que o motor continua manipulando. Resolve também um problema adjacente: o store só
   aceita JSON puro, e um passo carrega o que o executor devolveu — uma instância de classe de SDK
   seria recusada.
3. **No caminho de erro, o flush insiste.** Três tentativas espaçadas em 200 ms, para atravessar a
   janela do flush em andamento.

## O que mudou depois

O motor foi extraído atrás de duas interfaces — navegador e progresso ([ADR 0004](../adr/0004-motor-de-execucao.md)).
O `ProgressReporter` existe por causa deste incidente: com ele, o motor passou a ser testável com
dublês, e hoje tem 14 testes que cobrem inclusive a ordem das publicações.

Vale notar o que **não** teria pegado: nenhum teste unitário do motor encontraria isto, porque o
defeito vivia na fronteira entre o nosso código e o do Trigger.dev. O que encontraria é um teste de
ponta a ponta que observasse a tela durante uma run — que só passou a existir na fase E, e que ainda
não cobre executar uma run.

## O que este documento não sabe

O commit da correção diz apenas `feature: implement live run status`. Não há registro de quanto tempo
o defeito levou para ser notado, nem de como foi diagnosticado. **O raciocínio sobreviveu apenas nos
comentários do código** — e foi de lá que este postmortem foi reconstruído, três semanas depois.

Essa é a lição de processo, separada da técnica: o conserto foi preservado, a investigação não. Um
comentário explica por que o código é assim; ele não conta o que se tentou antes, nem o que se
aprendeu a não fazer.
