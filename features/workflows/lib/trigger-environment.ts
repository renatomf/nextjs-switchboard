// A Trigger.dev secret key starts with its environment: tr_dev_, tr_prod_,
// tr_stg_ and so on.
const SECRET_KEY_PREFIX = /^tr_([a-z]+)_/

// Which Trigger.dev environment a secret key belongs to, read off its prefix
// so the app needs no setting of its own for it. Only the environment's name
// comes back: it ends up in a schedule's deduplication key and in logs, where
// no part of the secret may go.
export function triggerEnvironmentOf(secretKey: string | undefined): string {
  if (!secretKey) throw new Error("TRIGGER_SECRET_KEY is not set")

  const match = SECRET_KEY_PREFIX.exec(secretKey)

  if (!match) {
    throw new Error("TRIGGER_SECRET_KEY is not a Trigger.dev secret key")
  }

  return match[1]
}
