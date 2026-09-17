import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { decryptSecret, encryptSecret } from "./vault"

// A master key as the environment holds one: 32 bytes, base64. Two of them,
// because what a key *cannot* do — open what another key sealed — is half of
// what this module is for.
const KEY_A = randomBytes(32).toString("base64")
const KEY_B = randomBytes(32).toString("base64")

// Shaped like the thing this actually protects today.
const SECRET = "whsec_zH8Kq2mVx4pL9nR7tY3wB6cF1dG5jS0a"

// The envelope's parts, in order. Named so a test that tampers with one says
// which one it broke.
const VERSION = 0
const KEY_ID = 1
const WRAP_IV = 2
const WRAP_TAG = 3
const WRAPPED_DEK = 4
const IV = 5
const TAG = 6
const PAYLOAD = 7
const PART_COUNT = 8

let savedKey: string | undefined

beforeEach(() => {
  savedKey = process.env.CREDENTIALS_KEY
  process.env.CREDENTIALS_KEY = KEY_A
})

afterEach(() => {
  if (savedKey === undefined) delete process.env.CREDENTIALS_KEY
  else process.env.CREDENTIALS_KEY = savedKey
})

// Breaks one segment of an envelope while keeping it well-formed base64url, so
// what refuses the result is the authentication tag rather than a decoder.
function tamper(envelope: string, part: number): string {
  const parts = envelope.split(".")
  const segment = parts[part]

  parts[part] = (segment[0] === "A" ? "B" : "A") + segment.slice(1)

  return parts.join(".")
}

describe("encryptSecret", () => {
  it("hands back something the plaintext cannot be read out of", () => {
    const envelope = encryptSecret(SECRET)

    expect(envelope).not.toContain(SECRET)
    // The prefix too: a value that kept it would tell a reader what kind of
    // secret this is, which is the whole point of the prefix.
    expect(envelope).not.toContain("whsec_")
  })

  it("marks the envelope with a version, so the format can change later", () => {
    expect(encryptSecret(SECRET).split(".")[VERSION]).toBe("v1")
  })

  it("lays the envelope out in the parts opening it needs", () => {
    expect(encryptSecret(SECRET).split(".")).toHaveLength(PART_COUNT)
  })

  // A fresh data key and a fresh IV every time. Without this, two workflows
  // given the same secret would seal to the same bytes, and equal ciphertexts
  // would tell a reader the secrets are equal.
  it("seals the same secret differently every time", () => {
    expect(encryptSecret(SECRET)).not.toBe(encryptSecret(SECRET))
  })

  it("names which master key sealed it, so rotation can be detected", () => {
    const sealedWithA = encryptSecret(SECRET).split(".")[KEY_ID]

    process.env.CREDENTIALS_KEY = KEY_B
    const sealedWithB = encryptSecret(SECRET).split(".")[KEY_ID]

    expect(sealedWithA).not.toBe(sealedWithB)
  })

  // The id has to say *which* key without helping anyone rebuild it.
  it("does not put the master key in the envelope", () => {
    const envelope = encryptSecret(SECRET)

    expect(envelope).not.toContain(KEY_A)
    expect(envelope).not.toContain(Buffer.from(KEY_A, "base64").toString("hex"))
  })
})

describe("decryptSecret", () => {
  it("reads back exactly what was sealed", () => {
    expect(decryptSecret(encryptSecret(SECRET))).toBe(SECRET)
  })

  it("survives a value that is not ASCII", () => {
    const value = "sénha-com-acento-😀-and-a-very-long-tail".repeat(20)

    expect(decryptSecret(encryptSecret(value))).toBe(value)
  })

  // Each of these is a way a stored row could have been changed by someone who
  // could write to the database but had no key. GCM's tag is what turns every
  // one of them into a refusal instead of a wrong answer handed back as if it
  // were right.
  it.each([
    ["the sealed secret", PAYLOAD],
    ["the wrapped data key", WRAPPED_DEK],
    ["the secret's nonce", IV],
    ["the secret's tag", TAG],
    ["the wrapping nonce", WRAP_IV],
    ["the wrapping tag", WRAP_TAG],
  ])("refuses an envelope whose %s was altered", (_, part) => {
    expect(() => decryptSecret(tamper(encryptSecret(SECRET), part))).toThrow()
  })

  it("refuses an envelope sealed by a different master key", () => {
    const envelope = encryptSecret(SECRET)

    process.env.CREDENTIALS_KEY = KEY_B

    expect(() => decryptSecret(envelope)).toThrow()
  })

  it("refuses a version it does not know how to open", () => {
    const envelope = encryptSecret(SECRET).replace(/^v1\./, "v2.")

    expect(() => decryptSecret(envelope)).toThrow(/version/i)
  })

  it("refuses something that is not an envelope at all", () => {
    expect(() => decryptSecret("whsec_plain_value")).toThrow()
  })
})

// The key is read on every call rather than held: a wrong or missing one has
// to fail loudly at the point of use, and rotation must not need a restart.
describe("the master key", () => {
  it("says which variable is missing when there is none", () => {
    delete process.env.CREDENTIALS_KEY

    expect(() => encryptSecret(SECRET)).toThrow(/CREDENTIALS_KEY/)
  })

  it("refuses a key that is not 32 bytes", () => {
    process.env.CREDENTIALS_KEY = randomBytes(16).toString("base64")

    expect(() => encryptSecret(SECRET)).toThrow(/32/)
  })
})
