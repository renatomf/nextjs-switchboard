import type { Stagehand } from "@browserbasehq/stagehand"

// Hands a whole goal to Stagehand's agent, which plans and executes as many steps
// as it takes on its own. Unlike act, which performs exactly one action, this runs
// a loop — so it is the most capable node and by far the most expensive, since
// every step it decides to take is another model call.
export async function agent({
  stagehand,
  instruction,
}: {
  stagehand: Stagehand
  instruction: string
}) {
  const result = await stagehand.agent().execute(instruction)

  // success and completed answer different questions: whether the steps it took
  // worked, and whether it considers the goal actually finished. An agent that
  // gives up part-way can report success without completion.
  return {
    success: result.success,
    message: result.message,
    completed: result.completed,
  }
}
