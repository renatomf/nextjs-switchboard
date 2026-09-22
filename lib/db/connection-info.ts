// Which database a process is actually talking to, in a form that is safe to
// print. Two environments sharing one code base is the normal state here — the
// app and the Trigger.dev worker each carry their own DATABASE_URL — and when
// they disagree the symptom looks like missing data rather than like
// misconfiguration. A line at startup turns that into a fact anyone can read.

export type ConnectionInfo = {
  // The compute endpoint, which is what tells two Neon branches apart. For a
  // database that is not Neon, the host.
  endpoint: string
  // Whether the connection goes through the pooler. Migrations need one that
  // does not, so this being wrong has its own distinct failure.
  pooled: boolean
}

const UNKNOWN: ConnectionInfo = { endpoint: "unknown", pooled: false }

export function describeConnection(connectionString: string): ConnectionInfo {
  let hostname: string

  try {
    hostname = new URL(connectionString).hostname
  } catch {
    // Called while the process starts. A string this cannot parse must not be
    // the reason the app fails to boot: the connection itself will fail with a
    // better message than anything invented here.
    return UNKNOWN
  }

  if (!hostname) return UNKNOWN

  const endpoint = hostname.split(".")[0]

  return {
    endpoint: endpoint.replace(/-pooler$/, ""),
    pooled: endpoint.endsWith("-pooler"),
  }
}
