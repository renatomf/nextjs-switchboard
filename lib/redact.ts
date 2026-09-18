// Error messages are written down in two places a person later reads: the
// execution row in the database and the step's error on the canvas, which also
// goes to the run's log. What a failing request puts in its message is not
// chosen by us — a URL with credentials in it, a rejected Authorization
// header, a provider echoing the key it refused — so the text has to be
// cleaned before it is stored rather than trusted because it "is just an
// error".
//
// The hard part is not hiding things. It is hiding only what must go: an error
// nobody can read gets ignored, and the next real failure hides in the noise.
// So this matches named shapes rather than guessing at entropy, and every rule
// keeps the part that says *where* the failure was — the host, the path, the
// parameter's name, the word Bearer.

// What replaces a secret. A marker rather than an empty string, so a message
// says that something was taken out instead of quietly reading as if the value
// had never been there.
const MARKER = "[redacted]"

// Parameters whose value is a credential wherever it appears. Longest first,
// so signature is not half-matched by sig.
const SENSITIVE_PARAMS =
  "access_token|refresh_token|api[_-]?key|apikey|credential|signature|password|passwd|secret|token|auth|pwd|key|sig"

const RULES: [RegExp, string][] = [
  // Credentials in a URL's userinfo: postgres://user:pass@host. Both halves
  // go; the host and path stay, because that is the half that says what was
  // being reached.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+(?::[^/\s@]*)?@/gi, `$1${MARKER}@`],

  // token=..., api_key=..., signature=... — in a query string or standing on
  // its own. The name survives: "which parameter was rejected" is most of the
  // answer, and it is not the secret.
  [
    new RegExp(`(^|[?&\s])((?:${SENSITIVE_PARAMS})=)[^&\s#]+`, "gi"),
    `$1$2${MARKER}`,
  ],

  // Authorization headers. The scheme stays: Bearer and Basic fail for
  // different reasons, and knowing which one was sent is worth keeping.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${MARKER}`],

  // A JSON web token anywhere in the text, header and payload included: the
  // payload is base64, not encryption, so it is readable to anyone who sees it.
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, MARKER],

  // Keys that announce themselves. A prefix exists so a leaked key can be
  // recognised and revoked — which makes it exactly what to match on here.
  [/\bwhsec_[A-Za-z0-9_-]{8,}/g, MARKER],
  [/\bsk-ant-[A-Za-z0-9_-]{8,}/g, MARKER],
  [/\bsk_(?:live|test|prod|dev)_[A-Za-z0-9]{8,}/g, MARKER],
  [/\btr_(?:prod|dev)_[A-Za-z0-9]{8,}/g, MARKER],
  [/\bbb_(?:live|test)_[A-Za-z0-9]{8,}/g, MARKER],
  [/\bghp_[A-Za-z0-9]{16,}/g, MARKER],
  [/\bxox[baprs]-[A-Za-z0-9-]{8,}/g, MARKER],
  [/\bAKIA[0-9A-Z]{12,}/g, MARKER],
  [/\bAIza[A-Za-z0-9_-]{20,}/g, MARKER],
]

// Takes the credentials out of a message meant to be stored or shown. Safe to
// run more than once: a message can reach both sinks, and running this twice
// gives what running it once gave.
export function redactSecrets(message: string): string {
  return RULES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    message
  )
}
