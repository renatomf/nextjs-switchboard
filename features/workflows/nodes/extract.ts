import type { Stagehand } from "@browserbasehq/stagehand"

// Pulls whatever the instruction describes off the current page. Called without
// a schema, so Stagehand answers with its default shape — a single `extraction`
// string. A node that needs structured fields back would need a schema field of
// its own to pass along.
export async function extract({
  stagehand,
  instruction,
}: {
  stagehand: Stagehand
  instruction: string
}) {
  const { extraction } = await stagehand.extract(instruction)

  return { extraction }
}
