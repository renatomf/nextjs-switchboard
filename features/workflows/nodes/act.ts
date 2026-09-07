import type { Stagehand } from "@browserbasehq/stagehand"

// Runs one natural-language action against the page Stagehand is already on —
// a click, a keystroke, a scroll. Instructions should stay atomic ("click the
// sign in button"), so a whole flow is several act nodes rather than one.
export async function act({
  stagehand,
  instruction,
}: {
  stagehand: Stagehand
  instruction: string
}) {
  // act resolves whether or not the model managed the action, so success and
  // message are reported as outputs rather than thrown — a downstream node can
  // read them and the run keeps going.
  const result = await stagehand.act(instruction)
  // Read after the action, so a click that navigated reports where it landed.
  const page = stagehand.context.pages()[0]

  return { success: result.success, message: result.message, url: page.url() }
}
