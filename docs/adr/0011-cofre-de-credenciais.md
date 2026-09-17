# ADR 0011 — Cofre de credenciais

- **Status:** aceito
- **Data:** 2026-09-16
- **Onde:** `lib/vault.ts`, `features/workflows/data.ts`,
  `app/api/webhooks/workflows/[id]/route.ts`, `lib/db/schema.ts`
  (`workflow_webhooks.secret`, sem mudança de tipo)

## Contexto

O segredo do webhook ficava em claro numa coluna `text`, e o [ADR 0009](0009-trigger-por-webhook.md)
registrou isso como ⚠️ desde o primeiro dia. Quem lê o banco lê o segredo — um backup, uma branch do
Neon, uma connection string vazada — e ler esse segredo não é só ler: é poder **disparar** workflows
daquela organização, porque é ele que assina as chamadas.

Vale registrar também o que o levantamento feito antes desta decisão **não** encontrou, porque foi o
que definiu o escopo. Nenhum campo de nó pede credencial: `NodeField` é `key/label/placeholder/
multiline/required`, e os campos existentes são URL, instrução e to/subject/body. O `send-email` usa
a chave do Resend do lado do servidor, não um campo do canvas. Ou seja, o cofre cobre **um** segredo
hoje; o desenho existe para quando houver mais.

## Decisão

- **Criptografia, não hash.** Uma senha seria hasheada, porque ninguém precisa dela de volta.
  Conferir uma assinatura HMAC recomputa o digest com o segredo original, então isto tem de ser
  reversível. O que se compra é proteção contra o banco ser lido **sem a chave**.
- **Envelope:** cada segredo ganha a própria chave de dados (DEK, AES-256-GCM), e só a DEK é
  embrulhada com a chave-mestra (KEK) do ambiente, `CREDENTIALS_KEY` — 32 bytes em base64.
- **Formato `v1`, oito partes em base64url:**
  `v1.<keyId>.<wrapIv>.<wrapTag>.<wrappedDek>.<iv>.<tag>.<payload>`.
- **O `keyId` são 8 bytes do SHA-256 da chave-mestra:** diz *qual* chave selou a linha sem ajudar a
  reconstruí-la. É o que torna rotação uma operação de verdade em vez de um plano.
- **A chave é lida a cada chamada,** não guardada em variável de módulo: uma chave ausente falha no
  ponto de uso, e uma chave rotacionada passa a valer sem reiniciar o processo.
- **O limite do texto em claro é a camada de dados.** `saveWorkflowWebhook` sela;
  `getWebhookForRequest` abre. Nenhum chamador pode esquecer.
- **O caminho da página não seleciona a coluna do segredo.** Ela só usa `lastUsedAt`, e a forma
  garantida de um segredo nunca chegar ao HTML é a consulta não pedir por ele.
- **Um segredo que não abre responde `503`,** antes de a chamada ser contada no limite de frequência,
  e é reportado ao Sentry.
- **Migração por rotação, não por backfill.** Havia exatamente uma linha, em claro.
- **Sem mudança de schema:** `text` não tem limite no Postgres e o envelope cabe.

## Alternativas consideradas

| Alternativa | Por que não |
| --- | --- |
| Guardar o hash do segredo | HMAC precisa do valor de volta; hash impede a verificação (já registrado no 0009) |
| Uma chave só, sem DEK por segredo | Rotacionar a mestra exigiria reescrever todos os segredos, e uma chave recuperada abriria todos eles |
| Aceitar texto em claro como alternativa na leitura | Abre rebaixamento: quem escreve no banco troca um valor selado por um em claro à sua escolha, e o app aceita |
| Script de backfill | Uma linha só. Rotacionar já é ação existente na interface, e ainda troca um segredo que passou tempo em claro |
| KMS agora (AWS, GCP) | Separa de verdade a chave do banco, mas adiciona dependência, latência e custo. O `keyId` deixa essa mudança possível depois, sem migrar dados |
| Selar na action, não na camada de dados | Um chamador futuro esqueceria, e o teste que afirma o que a action entrega teria de casar com um envelope aleatório |

## Consequências

- ✅ **Quem lê o banco sem a chave não obtém segredo utilizável** — que era exatamente o ⚠️ aberto
  desde o ADR 0009.
- ✅ **Rotação da chave-mestra é operação real:** o `keyId` identifica quais linhas ainda estão na
  chave antiga.
- ✅ **O caminho da página nunca segura segredo,** nem selado.
- ⚠️ **A chave-mestra mora no ambiente, ao lado da `DATABASE_URL`.** Isto defende o banco, não a
  máquina: quem lê o ambiente inteiro leva as duas. Separar exige KMS.
- ⚠️ **Perder a `CREDENTIALS_KEY` é perder os segredos.** Não há recuperação — só rotacionar cada
  webhook.
- ⚠️ **Janela entre o deploy e a rotação:** o segredo antigo, gravado em claro, não abre, e a rota
  responde 503 até a rotação acontecer.
- ⚠️ **Campos de nó continuam sem cobertura.** Quando existir um campo de credencial, ele deve
  **referenciar** uma entrada do cofre e nunca conter o valor: o que entra no grafo é copiado para
  toda versão imutável, e apagar do canvas não apaga do histórico.
- ⚠️ **A chave precisa existir no ambiente do app.** O worker do Trigger.dev não lê segredo de
  webhook, então não precisa dela — o que mantém o raio de exposição menor.
