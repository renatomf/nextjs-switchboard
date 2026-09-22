import { describe, expect, it } from "vitest"

import { describeConnection } from "./connection-info"

const NEON =
  "postgresql://neondb_owner:npg_SECRET@ep-lingering-wave-au12345.c-10.us-east-1.aws.neon.tech/neondb?sslmode=verify-full"

describe("describeConnection", () => {
  it("names the endpoint the process is talking to", () => {
    expect(describeConnection(NEON).endpoint).toBe("ep-lingering-wave-au12345")
  })

  it("says when the connection goes through the pooler", () => {
    expect(describeConnection(NEON).pooled).toBe(false)
    expect(
      describeConnection(NEON.replace("au12345.", "au12345-pooler.")).pooled
    ).toBe(true)
  })

  // The whole point is that this can be logged. A descriptor carrying the
  // password would turn an aid into a leak.
  it("carries nothing secret", () => {
    const described = JSON.stringify(describeConnection(NEON))

    expect(described).not.toContain("npg_SECRET")
    expect(described).not.toContain("neondb_owner")
  })

  it("works for a database that is not Neon", () => {
    expect(describeConnection("postgresql://u:p@localhost:5432/app")).toEqual({
      endpoint: "localhost",
      pooled: false,
    })
  })

  // This runs while the process is starting up. A connection string it cannot
  // parse must not be the reason the app fails to boot — the app has a real
  // error for that, and it is a better one than this could give.
  it.each([
    ["an empty string", ""],
    ["something that is not a URL", "not-a-connection-string"],
    ["a url with no host", "postgresql:///app"],
  ])("never throws on %s", (_, value) => {
    expect(() => describeConnection(value)).not.toThrow()
    expect(describeConnection(value).endpoint).toBe("unknown")
  })
})
