# ADR 0006 — Concorrência de runs por organização, conforme o plano

- **Status:** aceito
- **Data:** 2026-09-14
- **Onde:** `features/workflows/lib/run-queues.ts`, `features/workflows/actions.ts`,
  `features/workflows/tasks/run-workflow.ts`

## Contexto

Todas as organizações dividiam o limite de concorrência do ambiente do Trigger.dev, sem um limite
próprio. Isso trazia dois problemas:

- **Vizinho barulhento:** uma organização que dispara muitas runs ocupa todas as vagas, e as das
  outras ficam esperando.
- **Custo:** cada run abre uma sessão de navegador e faz chamadas ao modelo, e o plano gratuito
  podia abrir quantas quisesse ao mesmo tempo.

Como o Trigger.dev funciona aqui:

- cada run entra numa fila, e o `concurrencyLimit` da fila limita quantas executam ao mesmo tempo.
  As que esperam não contam;
- o `concurrencyKey` cria uma cópia da fila para cada valor da chave;
- desde a v4, as filas precisam ser declaradas no código com `queue()`, e a run escolhe a fila só
  pelo nome;
- uma run usa uma fila só, com uma chave só.

## Decisão

- **Uma fila por plano:** `runs-free`, com 1 run por vez, e `runs-pro`, com 3.
- **A organização é a chave de concorrência,** o que dá a cada organização a sua própria cópia da
  fila do plano.
- **A action escolhe a fila pelo plano,** com o mesmo `has({ plan: PRO_PLAN })` que já usa para
  bloquear os nós premium.
- **A run acima do limite espera como `queued`,** sem falhar. A interface já mostra esse estado, e o
  Stop já cancela uma run na fila (B.2).
- **As filas são declaradas no worker** (`run-workflow.ts`), com nomes e limites vindos de um
  módulo puro (`run-queues.ts`) que a action também usa. A fila padrão da task é a Free: uma run
  disparada sem fila cai no limite mais restrito.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Limitar por workflow (`concurrencyKey` = workflow, limite 1) | Serializa cada workflow, mas não limita a organização: quem tem 50 workflows roda 50 ao mesmo tempo |
| Os dois limites ao mesmo tempo | Uma run usa uma fila só, com uma chave só |
| Recusar o Run acima do limite | Transforma um limite de capacidade em erro para o usuário, quando esperar na fila resolve |

## Consequências

- ✅ Uma organização não consegue ocupar as vagas das outras, e o plano gratuito tem um teto de custo.
- ✅ No plano Free, o limite de 1 por organização também impede duas runs do mesmo workflow ao mesmo
  tempo.
- ⚠️ **No plano Pro, duas runs do mesmo workflow ainda podem executar juntas.** A interface supõe uma
  run por workflow: o Stop enxerga só uma. Garantir isso no servidor fica para a C.2.
- ⚠️ Os limites são constantes no código. Mudar o limite de um plano exige deploy do worker e do app.
- ⚠️ **A ordem de deploy importa: primeiro o worker, depois o app.** No teste em desenvolvimento, uma
  run enviada para `runs-pro` antes de o worker registrar a fila não deu erro: ficou em `queued` sem
  nunca começar, até ser cancelada. Com o app publicado antes do worker, o Run continuaria
  respondendo, e as runs ficariam paradas sem aviso.
