import { redactSecrets } from "./redact"

// What goes to Sentry leaves this infrastructure, which makes it the one sink
// where a leak is hardest to take back. The other two — the executions row and
// the step error on the canvas — are cleaned at the point they are written
// (ADR 0012); this cleans an event on its way out.
//
// It matters more here than it looks, because the server config sets
// includeLocalVariables, which puts local values on stack frames. This code
// base has locals holding a plaintext secret: the one saveWorkflowWebhook is
// given, and the vault's master key.

const MARKER = "[redacted]"

// Deep enough for a Sentry event, and a stop for anything pathological.
const MAX_DEPTH = 8

// Field names whose value is a credential whatever it happens to look like.
// This is the half that catches what redactSecrets cannot: a master key is
// raw base64 with no prefix to recognise, so the name is all there is.
const CREDENTIAL_WORDS = new Set([
  "secret",
  "token",
  "password",
  "passwd",
  "pwd",
  "credential",
  "credentials",
  "signature",
  "sig",
  "auth",
  "authorization",
  "cookie",
  "key",
  "apikey",
])

// Splits a field name into words across camelCase, snake_case and kebab-case,
// so the match is on whole words. Without it "monkey" reads as a key and
// "tokenizer" as a token — and a redactor that eats ordinary fields is one
// somebody turns off.
function wordsOf(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
}

function namesACredential(name: string): boolean {
  return wordsOf(name).some((word) => CREDENTIAL_WORDS.has(word))
}

// Only walk what is plainly data. A Date, an Error, a Buffer rebuilt as a bag
// of keys would be worse than what it replaced.
function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value)

  return proto === Object.prototype || proto === null
}

function walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactSecrets(value)

  if (value === null || typeof value !== "object") return value

  if (depth >= MAX_DEPTH) return value

  // Sentry events can point back at themselves through contexts. The depth cap
  // would stop it eventually; this stops it at the first repeat and keeps the
  // rest of the event intact.
  if (seen.has(value)) return value

  if (Array.isArray(value)) {
    seen.add(value)

    return value.map((item) => walk(item, depth + 1, seen))
  }

  if (!isPlainObject(value)) return value

  seen.add(value)

  return Object.fromEntries(
    Object.entries(value).map(([name, item]) => [
      name,
      namesACredential(name) && item !== null && item !== undefined
        ? MARKER
        : walk(item, depth + 1, seen),
    ])
  )
}

// Cleans an event on its way to Sentry. Never throws: it runs inside
// beforeSend, on a process that is already reporting a problem, and losing the
// report would be worse than sending it unredacted.
export function redactEvent<T>(event: T): T {
  try {
    // The walk rebuilds plain objects and arrays, so the shape it returns is
    // the shape it was given — the cast says that once, here, instead of at
    // every call site.
    return walk(event, 0, new WeakSet()) as T
  } catch {
    return event
  }
}
