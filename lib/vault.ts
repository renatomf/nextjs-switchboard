import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

// Encryption, not hashing. A password would be hashed, because nobody ever
// needs it back — only a "does this match" answer. A webhook secret is the
// opposite: verifying a signature recomputes an HMAC with the original secret,
// so this has to be reversible. What that buys is protection against the
// database being read without the key: a backup, a Neon branch, a leaked
// connection string.
//
// What it does not buy, and the reason this is worth writing down rather than
// discovering later: the master key lives in the environment, next to
// DATABASE_URL. Someone who reads the whole environment gets both. Separating
// them is what a KMS is for, and the key id below is what makes that move
// possible without a data migration.

// Envelope encryption: each secret gets its own data key, and only that data
// key is wrapped with the master key.
//
// Against sealing everything directly under the master key, this buys two
// things. Rotating the master key rewraps data keys instead of rewriting every
// secret — cheap, and it can be done row by row. And one recovered data key
// opens one secret rather than all of them.
const VERSION = "v1"

const ALGORITHM = "aes-256-gcm"

// AES-256 keys, both the master key and the per-secret data keys.
const KEY_BYTES = 32

// 96 bits, which is the nonce size GCM is defined for. Random per use, and
// never reused with the same key — the data key is fresh every time, so the
// pair cannot repeat.
const IV_BYTES = 12

// Enough of the master key's fingerprint to tell two keys apart, and far too
// little to help rebuild one.
const KEY_ID_BYTES = 8

const ENV_VAR = "CREDENTIALS_KEY"

// Read on every call rather than held in a module variable: a missing key has
// to fail at the point of use, where the log says which secret was being
// opened, and a rotated key must take effect without a restart.
function masterKey(): Buffer {
  const configured = process.env[ENV_VAR]

  if (!configured) {
    throw new Error(
      `${ENV_VAR} is not set. Generate one with: openssl rand -base64 32`
    )
  }

  const key = Buffer.from(configured, "base64")

  if (key.length !== KEY_BYTES) {
    throw new Error(
      `${ENV_VAR} must decode to ${KEY_BYTES} bytes, got ${key.length}`
    )
  }

  return key
}

// Which master key sealed an envelope, without carrying anything that helps
// reconstruct it. A hash, not the key: the envelope is stored in the same
// database the key is meant to protect.
function keyIdOf(key: Buffer): string {
  return createHash("sha256")
    .update(key)
    .digest()
    .subarray(0, KEY_ID_BYTES)
    .toString("base64url")
}

// Seals a secret for storage. The result is one string, safe to put in a text
// column, and it carries everything opening it needs except the master key.
export function encryptSecret(plaintext: string): string {
  const key = masterKey()

  // This secret's own key, used once and never stored in the clear.
  const dataKey = randomBytes(KEY_BYTES)

  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, dataKey, iv)
  const payload = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ])

  // The data key, wrapped under the master key with its own nonce and tag.
  const wrapIv = randomBytes(IV_BYTES)
  const wrapper = createCipheriv(ALGORITHM, key, wrapIv)
  const wrappedDataKey = Buffer.concat([
    wrapper.update(dataKey),
    wrapper.final(),
  ])

  return [
    VERSION,
    keyIdOf(key),
    wrapIv.toString("base64url"),
    wrapper.getAuthTag().toString("base64url"),
    wrappedDataKey.toString("base64url"),
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    payload.toString("base64url"),
  ].join(".")
}

const PART_COUNT = 8

// Opens a sealed secret. Every failure here throws rather than returning
// something falsy: a caller that treats "could not open this" as "there is no
// secret" would verify a signature against nothing.
export function decryptSecret(envelope: string): string {
  const parts = envelope.split(".")

  if (parts.length !== PART_COUNT) {
    throw new Error("Not a sealed secret")
  }

  const [version, keyId, wrapIv, wrapTag, wrappedDataKey, iv, tag, payload] =
    parts

  // Checked before any key is touched, so a format this code predates is told
  // apart from a secret it genuinely cannot open.
  if (version !== VERSION) {
    throw new Error(`Unknown envelope version: ${version}`)
  }

  const key = masterKey()

  // A clearer answer than letting the tag fail below: this envelope was sealed
  // by a key this process does not have, which during a rotation is an
  // expected state and not corruption.
  if (keyId !== keyIdOf(key)) {
    throw new Error("Sealed by a different master key")
  }

  const unwrapper = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(wrapIv, "base64url")
  )
  unwrapper.setAuthTag(Buffer.from(wrapTag, "base64url"))

  const dataKey = Buffer.concat([
    unwrapper.update(Buffer.from(wrappedDataKey, "base64url")),
    unwrapper.final(),
  ])

  const decipher = createDecipheriv(
    ALGORITHM,
    dataKey,
    Buffer.from(iv, "base64url")
  )
  decipher.setAuthTag(Buffer.from(tag, "base64url"))

  return Buffer.concat([
    decipher.update(Buffer.from(payload, "base64url")),
    decipher.final(),
  ]).toString("utf8")
}
