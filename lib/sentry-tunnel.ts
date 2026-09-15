// A DSN's project id, from the path of its URL.
const projectIdOf = (dsn: URL) => dsn.pathname.replace(/^\/+|\/+$/g, "")

// Where a browser envelope may be forwarded, or null when it is not this
// project's to forward. Only the first line of an envelope is text (its header,
// carrying the DSN it was made for); what follows can be binary, such as a
// compressed replay segment, so the envelope stays bytes throughout. The target
// is built from the allowed DSN, not the envelope's, so the tunnel can only
// ever reach this project.
export function sentryEnvelopeTarget(
  envelope: Uint8Array,
  allowedDsn: string
): string | null {
  const newline = envelope.indexOf(0x0a)
  const headerLine = envelope.subarray(
    0,
    newline === -1 ? envelope.length : newline
  )

  let dsn: URL
  try {
    const header = JSON.parse(new TextDecoder().decode(headerLine))
    dsn = new URL(header.dsn)
  } catch {
    return null
  }

  const allowed = new URL(allowedDsn)

  if (
    dsn.hostname !== allowed.hostname ||
    projectIdOf(dsn) !== projectIdOf(allowed)
  ) {
    return null
  }

  return `https://${allowed.hostname}/api/${projectIdOf(allowed)}/envelope/`
}
