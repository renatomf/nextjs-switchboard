import { beforeEach, describe, expect, it, vi } from "vitest"

import { signWebhook } from "@/features/workflows/lib/webhook-signature"
import { POST } from "./route"

// The route stands between the open internet and a run: Postgres says whose
// webhook it is, Clerk whether that org still pays for it, and startWorkflowRun
// does the rest. Each is faked at its module boundary.
const {
  getWebhookForRequest,
  countWebhookCall,
  markWebhookUsed,
  getLatestWorkflowVersion,
  startWorkflowRun,
  fetchOrgIsPro,
} = vi.hoisted(() => ({
  getWebhookForRequest: vi.fn(),
  countWebhookCall: vi.fn(),
  markWebhookUsed: vi.fn(),
  getLatestWorkflowVersion: vi.fn(),
  startWorkflowRun: vi.fn(),
  fetchOrgIsPro: vi.fn(),
}))

vi.mock("@/features/workflows/data", () => ({
  getWebhookForRequest,
  countWebhookCall,
  markWebhookUsed,
  getLatestWorkflowVersion,
}))
vi.mock("@/features/workflows/start-run", () => ({ startWorkflowRun }))
vi.mock("@/lib/org-plan", () => ({ fetchOrgIsPro }))
vi.mock("@sentry/nextjs", () => ({
  getIsolationScope: () => ({ setAttributes: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  captureException: vi.fn(),
}))

const secret = "whsec_the_workflows_secret"
const body = '{"event":"order.paid"}'

// A request as a sender makes it: the raw body, signed with the workflow's
// secret, now.
function call({
  signature = signWebhook({ secret, body, at: new Date() }),
  headers = {},
}: {
  signature?: string | null
  headers?: Record<string, string>
} = {}) {
  return POST(
    new Request("https://switchboard.test/api/webhooks/workflows/wf_1", {
      method: "POST",
      body,
      headers: {
        "content-type": "application/json",
        ...(signature ? { "x-switchboard-signature": signature } : {}),
        ...headers,
      },
    }),
    { params: Promise.resolve({ id: "wf_1" }) }
  )
}

describe("POST /api/webhooks/workflows/[id]", () => {
  // wf_1 belongs to org A, which is on Pro and has a webhook.
  beforeEach(() => {
    getWebhookForRequest.mockResolvedValue({
      workflowId: "wf_1",
      orgId: "org_a",
      secret,
    })
    countWebhookCall.mockResolvedValue(1)
    fetchOrgIsPro.mockResolvedValue(true)
    getLatestWorkflowVersion.mockResolvedValue({ id: "ver_3" })
    startWorkflowRun.mockResolvedValue({
      outcome: "started",
      runId: "run_1",
      versionId: "ver_3",
      queue: "runs-pro",
    })
    markWebhookUsed.mockResolvedValue(undefined)
  })

  it("starts a run of the workflow's newest version", async () => {
    const response = await call()

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      runId: "run_1",
      status: "started",
    })
    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org_a",
        workflowId: "wf_1",
        isPro: true,
        tags: ["webhook"],
      })
    )
    const [{ version }] = startWorkflowRun.mock.calls[0]
    await expect(version()).resolves.toEqual({ id: "ver_3" })
    expect(markWebhookUsed).toHaveBeenCalledWith("wf_1")
  })

  // One run per workflow holds here too: a caller that fires while a run is
  // going gets that run back rather than a second one.
  it("hands back the run already going", async () => {
    startWorkflowRun.mockResolvedValue({
      outcome: "already-going",
      runId: "run_live",
    })

    const response = await call()

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      runId: "run_live",
      status: "already-running",
    })
  })

  // Trigger.dev hands back the run an idempotency key already started rather
  // than starting another, even once that run is over. Calling that "started"
  // would tell the sender something this route did not do.
  it("says so when the key had already started that run", async () => {
    startWorkflowRun.mockResolvedValue({
      outcome: "started",
      runId: "run_1",
      versionId: "ver_3",
      queue: "runs-pro",
      isCached: true,
    })

    const response = await call({ headers: { "idempotency-key": "evt_123" } })

    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toEqual({
      runId: "run_1",
      status: "duplicate",
    })
  })

  // The same event delivered twice — which every sender does eventually —
  // must not become two runs.
  it("passes the caller's idempotency key on, under the workflow", async () => {
    await call({ headers: { "idempotency-key": "evt_123" } })

    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "webhook:wf_1:evt_123" })
    )
  })

  it("starts nothing without an idempotency key of its own", async () => {
    await call()

    expect(startWorkflowRun).toHaveBeenCalledWith(
      expect.not.objectContaining({ idempotencyKey: expect.anything() })
    )
  })

  describe("refuses", () => {
    it("a request with no signature", async () => {
      const response = await call({ signature: null })

      expect(response.status).toBe(401)
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })

    it("a signature made with another secret", async () => {
      const response = await call({
        signature: signWebhook({
          secret: "whsec_not_the_one",
          body,
          at: new Date(),
        }),
      })

      expect(response.status).toBe(401)
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })

    // An unsigned caller must not be able to fill the counter and lock the
    // real sender out for the rest of the window.
    it("an unsigned request before it counts against the limit", async () => {
      await call({ signature: null })

      expect(countWebhookCall).not.toHaveBeenCalled()
    })

    // The same answer for a workflow that has no webhook and one that does
    // not exist, so a caller cannot learn which ids are real.
    it("a workflow with no webhook, saying nothing about why", async () => {
      getWebhookForRequest.mockResolvedValue(undefined)

      const response = await call()

      expect(response.status).toBe(404)
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })

    // What the window between deploying the vault and rotating a secret that
    // was stored before it looks like from outside: the row is there and the
    // caller is honest, but the value cannot be opened. Answered as "not right
    // now" rather than crashing into a 500 — and without spending the sender's
    // rate limit on our problem.
    it("a secret it cannot open, telling the sender to come back", async () => {
      getWebhookForRequest.mockRejectedValue(new Error("Not a sealed secret"))

      const response = await call()

      expect(response.status).toBe(503)
      expect(countWebhookCall).not.toHaveBeenCalled()
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })

    it("a caller past the limit, telling it how long to wait", async () => {
      countWebhookCall.mockResolvedValue(11)

      const response = await call()

      expect(response.status).toBe(429)
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0)
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })

    // Out of runs for the month is not "slow down", but the sender is an
    // automated one: it is told how long the month has left rather than
    // being left to guess.
    it("an org out of runs for the month, saying when to come back", async () => {
      startWorkflowRun.mockResolvedValue({
        outcome: "over-quota",
        used: 500,
        limit: 500,
      })

      const response = await call()

      expect(response.status).toBe(429)
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0)
      await expect(response.json()).resolves.toEqual(
        expect.objectContaining({ used: 500, limit: 500 })
      )
    })

    it("an org no longer on Pro", async () => {
      fetchOrgIsPro.mockResolvedValue(false)

      const response = await call()

      expect(response.status).toBe(403)
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })

    // Clerk not answering is not an answer: nothing is started, and the
    // sender is told to come back.
    it("everything while Clerk cannot say, without starting a run", async () => {
      fetchOrgIsPro.mockRejectedValue(new Error("Clerk answered 503"))

      const response = await call()

      expect(response.status).toBe(503)
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })

    it("a workflow with no version to run", async () => {
      getLatestWorkflowVersion.mockResolvedValue(undefined)

      const response = await call()

      expect(response.status).toBe(409)
      expect(startWorkflowRun).not.toHaveBeenCalled()
    })
  })
})
