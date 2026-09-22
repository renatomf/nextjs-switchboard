import "server-only"

import { attachDatabasePool } from "@vercel/functions"
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { describeConnection } from "./connection-info"
import * as schema from "./schema"

// The pool is cached on globalThis so Next.js dev/HMR reloads reuse a single
// pool instead of opening a new one on every module re-evaluation.
const globalForDb = globalThis as unknown as {
  pool: Pool | undefined
}

function connect(connectionString: string) {
  const pool = globalForDb.pool ?? new Pool({ connectionString })

  if (process.env.NODE_ENV !== "production") {
    globalForDb.pool = pool
  }

  // Lets Vercel Fluid drain idle connections when a compute instance shuts down.
  // No-op outside of Vercel.
  attachDatabasePool(pool)

  return drizzle(pool, { schema, casing: "snake_case" })
}

let db: ReturnType<typeof connect> | undefined

// Built on first use rather than at module scope, matching the other clients in
// lib/: `next build` imports every route to collect page data, and a build
// environment carries no DATABASE_URL, so checking for it at import time fails
// the build.
export function getDb() {
  if (!db) {
    const url = process.env.DATABASE_URL

    if (!url) {
      throw new Error("DATABASE_URL is not set")
    }

    // Said once, on the first query of the process. Both the app and the
    // Trigger.dev worker come through here with their own DATABASE_URL, and
    // when the two point at different branches the symptom is a run failing
    // to find data that plainly exists — which reads as a bug, not as
    // configuration. Carries no credentials (see describeConnection).
    const { endpoint, pooled } = describeConnection(url)
    console.info(`[db] endpoint ${endpoint}${pooled ? " (pooled)" : ""}`)

    db = connect(url)
  }

  return db
}
