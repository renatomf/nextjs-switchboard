# ADR 0012 — Redação de segredos em mensagens de erro

- **Status:** aceito
- **Data:** 2026-09-18
- **Onde:** `lib/redact.ts`, `features/workflows/tasks/execution-tracking.ts`,
  `features/workflows/engine/run-steps.ts`

## Contexto

A mensagem de um erro é escrita em dois lugares que alguém lê depois: a coluna `executions.error` no
banco e o erro do passo no canvas — que também vira linha de log da run no Trigger.dev.

O conteúdo dessa mensagem **não é escolhido por nós**. Ele vem do `fetch`, do SDK de um fornecedor,
do driver do Postgres. E as formas em que credencial aparece em mensagem de biblioteca são
conhecidas: URL com usuário e senha no userinfo (`postgres://user:senha@host`), header
`Authorization` recusado, provedor ecoando a chave que rejeitou, token numa query string.

O destino agrava: a coluna do banco é legível por qualquer um que alcance o banco — o cofre do
[ADR 0011](0011-cofre-de-credenciais.md) protege o segredo do webhook, não o texto de erro — e o erro
do passo aparece na tela para qualquer membro da organização.

## Decisão

- **Uma função pura, `redactSecrets`,** aplicada nos dois funis que já existiam: o `messageOf` do
  `run-steps` e o `error` passado ao `advanceExecution` no `execution-tracking`. Dois pontos, porque
  cada caminho já tinha um só.
- **Redigir antes do corte de 2.000 caracteres,** nunca depois: cortar primeiro deixaria meia
  credencial gravada, o que continua vazamento e já não casa com o padrão que a pegaria.
- **Formas nomeadas, não entropia:** userinfo de URL, parâmetros sensíveis (`token`, `api_key`,
  `signature`, `password`…), esquemas `Bearer` e `Basic`, JWT, e prefixos de chave conhecidos
  (`whsec_`, `sk-ant-`, `sk_live_`, `tr_prod_`, `ghp_`, `AKIA…`, `AIza…`).
- **Marcador `[redacted]`,** não string vazia: a mensagem diz que algo foi retirado, em vez de ler
  como se o valor nunca tivesse existido.
- **O que fica é parte da decisão, não sobra:** o host, o caminho, o *nome* do parâmetro, a palavra
  `Bearer`, códigos de status e de erro, ids e UUIDs.
- **Idempotente**, porque uma mesma mensagem pode passar pelos dois destinos.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Heurística de entropia (esconder toda sequência "aleatória") | Comeria UUID, id de run e hash de commit. Um redator que engole o contexto é um redator que alguém desliga — e aí não protege nada |
| Não gravar mensagem nenhuma | Joga fora o diagnóstico. O erro existe para ser lido; sem ele sobra "falhou" |
| Redigir só na leitura, na interface | O segredo já estaria gravado. Redigir na escrita é o único ponto que impede o armazenamento |
| Cifrar a coluna de erro, como o segredo do webhook | Erro precisa ser legível em consulta e agregação, e cifrar não impediria o app de exibir o valor |
| Cortar em 2.000 e redigir depois | Meia credencial continua sendo vazamento, e o padrão já não a reconhece |

## Consequências

- ✅ **Um segredo que apareça numa mensagem não chega à coluna nem à tela.**
- ✅ **A mensagem continua servindo para depurar** — que é a condição para a redação sobreviver ao
  primeiro incidente em que alguém precisar dela.
- ⚠️ **Cobre formas conhecidas.** Um segredo sem prefixo, fora de URL e fora de parâmetro nomeado,
  passa. A defesa contra isso não é regex melhor, é não colocar credencial em lugar que vira mensagem.
- ⚠️ **Mensagens gravadas antes desta mudança não foram reescritas.** A coluna guarda o que já estava lá.
- ⚠️ **O Sentry recebe a exceção original, sem redação.** É outro caminho — `captureException` leva o
  erro inteiro, com `stack` e propriedades. Redigir ali é decisão própria (`beforeSend` no SDK, ou o
  scrubbing do lado do Sentry) e ainda não foi tomada.
