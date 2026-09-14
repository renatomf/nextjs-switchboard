import type { NextRequest } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { GET } from "./route"

// Clerk says who is asking, the executions table whose session it is, and
// Browserbase holds the recording. Each is faked at its module boundary.
const { auth, getExecutionBySession, retrieve, retrievePage } = vi.hoisted(
  () => ({
    auth: vi.fn(),
    getExecutionBySession: vi.fn(),
    retrieve: vi.fn(),
    retrievePage: vi.fn(),
  })
)

vi.mock("@clerk/nextjs/server", () => ({ auth }))
vi.mock("@/features/workflows/data", () => ({ getExecutionBySession }))
vi.mock("@/lib/browserbase", () => ({
  getBrowserbase: () => ({ sessions: { replays: { retrieve, retrievePage } } }),
}))
vi.mock("@sentry/nextjs", () => ({
  getIsolationScope: () => ({ setAttributes: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

function get(sessionId: string) {
  const request = {
    nextUrl: new URL(`http://localhost/api/replays/${sessionId}`),
  } as unknown as NextRequest

  return GET(request, { params: Promise.resolve({ sessionId }) })
}

describe("GET /api/replays/[sessionId]", () => {
  beforeEach(() => {
    auth.mockResolvedValue({
      userId: "user_1",
      orgId: "org_a",
      has: () => true,
    })
    getExecutionBySession.mockResolvedValue({ runId: "run_1" })
    retrieve.mockResolvedValue({ pages: [{ pageId: "page_1" }] })
    retrievePage.mockResolvedValue({ text: async () => "#EXTM3U" })
  })

  it("serves the playlist of a session one of the caller's runs opened", async () => {
    const response = await get("bb_1")

    expect(response.status).toBe(200)
    expect(await response.text()).toBe("#EXTM3U")
    expect(getExecutionBySession).toHaveBeenCalledWith("org_a", "bb_1")
  })

  // The IDOR this closes: the route used to serve any session id it was
  // handed to anyone signed in to any org.
  it("answers 404 for another org's session, without asking Browserbase", async () => {
    getExecutionBySession.mockResolvedValue(undefined)

    const response = await get("bb_other")

    expect(response.status).toBe(404)
    expect(retrieve).not.toHaveBeenCalled()
    expect(retrievePage).not.toHaveBeenCalled()
  })

  it("still requires the Pro plan", async () => {
    auth.mockResolvedValue({
      userId: "user_1",
      orgId: "org_a",
      has: () => false,
    })

    const response = await get("bb_1")

    expect(response.status).toBe(403)
    expect(retrieve).not.toHaveBeenCalled()
  })

  it("rejects a caller who is not signed in", async () => {
    auth.mockResolvedValue({ userId: null, orgId: null, has: () => false })

    const response = await get("bb_1")

    expect(response.status).toBe(401)
    expect(getExecutionBySession).not.toHaveBeenCalled()
  })
})
