import type { Stagehand } from "@browserbasehq/stagehand"
import { describe, expect, it, vi } from "vitest"

import { agent } from "./agent"

type AgentResult = { success: boolean; message: string; completed: boolean }

// Just enough of Stagehand for the node: agent().execute(instruction).
function stagehandWhoseAgentReturns(result: AgentResult) {
  const execute = vi.fn(async () => result)
  const stagehand = { agent: () => ({ execute }) } as unknown as Stagehand

  return { stagehand, execute }
}

describe("agent", () => {
  it("hands back what the agent reports when it worked", async () => {
    const { stagehand, execute } = stagehandWhoseAgentReturns({
      success: true,
      message: "Logged in as admin",
      completed: true,
    })

    await expect(agent({ stagehand, instruction: "Log in" })).resolves.toEqual({
      success: true,
      message: "Logged in as admin",
      completed: true,
    })
    expect(execute).toHaveBeenCalledWith("Log in")
  })

  // Success without completion: the steps it took worked, but it stopped short
  // of the goal. A result worth showing, not a failure.
  it("keeps an agent that stopped short of the goal as a result", async () => {
    const { stagehand } = stagehandWhoseAgentReturns({
      success: true,
      message: "Found the form but no submit button",
      completed: false,
    })

    await expect(
      agent({ stagehand, instruction: "Submit the form" })
    ).resolves.toMatchObject({ success: true, completed: false })
  })

  // Stagehand does not throw when the agent fails: it returns success: false.
  // Handed on as a result, that read as a finished step in a completed run.
  it("fails the step when the agent reports a failure", async () => {
    const { stagehand } = stagehandWhoseAgentReturns({
      success: false,
      message:
        "Failed to execute task: API key not valid. Please pass a valid API key.",
      completed: false,
    })

    await expect(agent({ stagehand, instruction: "Log in" })).rejects.toThrow(
      "Failed to execute task: API key not valid. Please pass a valid API key."
    )
  })
})
