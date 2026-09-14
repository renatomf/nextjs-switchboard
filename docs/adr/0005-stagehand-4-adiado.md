# ADR 0005 — Migração para o Stagehand 4 adiada

- **Status:** aceito
- **Data:** 2026-09-14
- **Onde:** `package.json` (`@browserbasehq/stagehand` 3.7.3), `features/workflows/nodes/`,
  `features/workflows/tasks/run-workflow.ts`

## Contexto

O roadmap previa a B.5 como uma troca de versão contida: com o motor separado da task (B.4), a
mudança ficaria nos executores dos nós e na abertura da sessão. A pesquisa na versão 4.1.0, nos
tipos do pacote e no guia oficial de migração, mostrou outra coisa:

- **A API de agente foi removida.** Os tipos da 4.1.0 não mencionam `agent` nenhuma vez, e o guia
  diz "agent() is gone". A alternativa é montar o próprio agente, com o Vercel AI SDK e as
  ferramentas do Stagehand ligadas por um cliente MCP. A documentação não traz um exemplo completo
  disso.
- **O resto muda de forma contida:**
  - a criação da sessão passa a ser `browserbase.launch()` e `Stagehand.create({ browser })`;
  - a página passa a ser obtida com `await`;
  - `act`, `extract` e `observe` passam a devolver `{ data, metadata }`;
  - os logs passam a ser configurados por um objeto `logging`.
- **O pacote é o mesmo nas duas versões.** Não dá para migrar os outros nós e manter o Agent na v3.

A v3 continua mantida: a 3.7.3 saiu em 28/08, depois da 4.0.0 (10/08), e o npm mantém a etiqueta
`v3-latest`.

## Decisão

- **Ficar na v3 (3.7.3).** O Dependabot já ignora os majors do Stagehand.
- **A reconstrução do Agent vira um item da Fase D** ("Agent com ferramentas sobre o Vercel AI
  SDK"), e a migração para a v4 acontece junto com ela, com o desenho do agente feito antes.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Migrar agora e reconstruir o Agent na mesma leva | Reconstruir às pressas o nó mais caro, sem desenho e sem exemplo oficial, por causa de uma dependência que continua mantida |
| Migrar agora e tirar o Agent do ar até a reconstrução | Remove uma funcionalidade premium por tempo indeterminado |
| Manter as duas versões com um alias do npm | Dois drivers de navegador e duas sessões na mesma run, quebrando o replay e o registro da sessão |

## Consequências

- ✅ Nenhuma funcionalidade sai do ar, e a Fase C começa sem esperar a migração.
- ⚠️ A v3 pode deixar de receber manutenção: acompanhar a etiqueta `v3-latest`.
- ⚠️ Fica para a migração testar se o `keepAlive` aceito na criação da sessão da v4 resolve a
  sessão órfã quando o worker cai, algo que a v3, via API, ignora.
