import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

// Tenant isolation in this project is enforced by the application, not by the
// database: the app connects as the tables' owner, which bypasses row-level
// security, so a query written without `orgId` would return another
// organisation's rows and nothing underneath would stop it.
//
// That guarantee used to live entirely in remembering to pass `orgId` — a
// review-time rule, which is the kind that holds until the day it doesn't.
// This turns it into a build-time one: every function in the data layer either
// takes an `orgId`, or is named below with the reason it does not need one.
//
// It is a shape check, not a proof. It cannot see whether a function that
// takes `orgId` actually filters on it. What it does catch is the cheap
// mistake — a new query added without the argument at all — and it makes
// adding an exception a deliberate act with a written justification.

const DATA_LAYER = path.join(__dirname, "data.ts")

// Functions that legitimately have no `orgId`, and why. Two kinds only:
// the platform looking after its own records across every org, and writes the
// worker makes against a run it is already executing, keyed by the run id it
// was handed.
//
// Adding a name here should feel like a decision. If a reason cannot be
// written in one line, the function probably wants the argument instead.
const WITHOUT_ORG_ID: Record<string, string> = {
  withWorkflowRunLock:
    "takes a lock on a workflow id and runs a callback; reads and writes nothing itself",
  listUnsettledExecutions:
    "the reconciliation sweep, across every org: the system looking after its own records",
  listExecutionsSince:
    "the weekly report, across every org: the platform measuring itself",
  listExecutionsMissingSessionSeconds:
    "the cost sweep, across every org, for the same reason",
  recordExecutionTokens:
    "the worker writing what its own run consumed, keyed by that run's id",
  recordExecutionSessionSeconds:
    "the sweep writing a session duration it just read, keyed by the run id",
  setExecutionBrowserSession:
    "the worker recording the session its own run opened, keyed by the run id",
  getScheduleForRun:
    "the scheduled task resolving the schedule that just fired, keyed by its Trigger.dev id",
  deactivateWorkflowSchedule:
    "the scheduled task switching off a schedule whose plan no longer allows it",
  getWebhookForRequest:
    "the webhook entry point, which has no session: the signature is what authorises it",
  countWebhookCall:
    "rate limiting the webhook above, per workflow and per minute window",
  markWebhookUsed:
    "idempotency for the webhook above, keyed by the caller's key",
}

// export function name(...) / export async function name<T>(...)
const EXPORTED_FUNCTION =
  /export\s+(?:async\s+)?function\s+(\w+)(?:<[^>]*>)?\s*\(([\s\S]*?)\)\s*[:{]/g

function exportedFunctions() {
  const source = fs.readFileSync(DATA_LAYER, "utf8")

  return [...source.matchAll(EXPORTED_FUNCTION)].map(
    ([, name, parameters]) => ({
      name,
      takesOrgId: /\borgId\b/.test(parameters),
    })
  )
}

describe("the data layer is scoped by organisation", () => {
  const functions = exportedFunctions()

  // A regex that silently matches nothing would make every assertion below
  // pass. Anchor it to a count that only moves deliberately.
  it("finds the exported functions it is meant to check", () => {
    expect(functions.length).toBeGreaterThan(25)
  })

  it("gives every function an orgId, or a written reason for not having one", () => {
    const unscoped = functions
      .filter((fn) => !fn.takesOrgId)
      .filter((fn) => !(fn.name in WITHOUT_ORG_ID))
      .map((fn) => fn.name)

    expect(
      unscoped,
      `These read or write tenant data without taking an orgId. Add the argument, ` +
        `or add the name to WITHOUT_ORG_ID with the reason it does not need one.`
    ).toEqual([])
  })

  // The other direction, so the list cannot rot into a rubber stamp: an
  // exception that no longer applies has to go, or the next reader will trust
  // a justification that stopped being true.
  it("keeps no stale exceptions", () => {
    const names = new Set(functions.map((fn) => fn.name))

    const gone = Object.keys(WITHOUT_ORG_ID).filter((name) => !names.has(name))
    expect(gone, "listed in WITHOUT_ORG_ID but no longer exported").toEqual([])

    const nowScoped = functions
      .filter((fn) => fn.takesOrgId && fn.name in WITHOUT_ORG_ID)
      .map((fn) => fn.name)
    expect(
      nowScoped,
      "these now take an orgId, so their exception should be removed"
    ).toEqual([])
  })

  it("explains every exception", () => {
    const unexplained = Object.entries(WITHOUT_ORG_ID)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([name]) => name)

    expect(
      unexplained,
      "an exception needs a reason, not a placeholder"
    ).toEqual([])
  })
})
